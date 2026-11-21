// Personal Agent helper: one request per launch. The DSH plugin starts this app through
// LaunchServices (`open`), so macOS asks for Calendar, Reminders, Notes and Mail access on behalf
// of this app rather than DSH, whose signature cannot request them. argv[1] is a JSON request with
// an "op" field, or "@<path>" naming a file that holds it (used for secrets, which must not appear
// in the process list); exactly one JSON reply is written to stdout.
import EventKit
import Foundation
import OSAKit
import Security

struct HelperError: Error {
  let code: String
  let message: String
}

func reply(_ body: [String: Any]) -> Never {
  let fallback = Data(#"{"ok":false,"code":"internal","message":"reply encoding failed"}"#.utf8)
  let data = (try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])) ?? fallback
  FileHandle.standardOutput.write(data)
  exit(0)
}

func invalid(_ message: String) -> HelperError { HelperError(code: "invalid_input", message: message) }

// A permission prompt left unanswered must not keep the caller waiting forever.
DispatchQueue.global().asyncAfter(deadline: .now() + 110) {
  reply(["ok": false, "code": "timeout", "message": "等待 macOS 授权或应用响应超时。如果弹出了授权窗口，请允许后重试。"])
}

// MARK: Dates

nonisolated(unsafe) let localOutput: ISO8601DateFormatter = {
  let formatter = ISO8601DateFormatter()
  formatter.timeZone = .current
  formatter.formatOptions = [.withInternetDateTime]
  return formatter
}()

let dayFormatter: DateFormatter = {
  let formatter = DateFormatter()
  formatter.calendar = Calendar(identifier: .gregorian)
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.timeZone = .current
  formatter.dateFormat = "yyyy-MM-dd"
  return formatter
}()

/// Accepts `YYYY-MM-DD` (a local calendar day) or ISO 8601 with seconds and a UTC offset.
func parseWhen(_ value: Any?, _ field: String) throws -> (date: Date, dayOnly: Bool) {
  guard let text = value as? String, !text.isEmpty else { throw invalid("\(field) is required") }
  if text.count == 10, let day = dayFormatter.date(from: text) { return (day, true) }
  for options: ISO8601DateFormatter.Options in [[.withInternetDateTime], [.withInternetDateTime, .withFractionalSeconds]] {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = options
    if let date = formatter.date(from: text) { return (date, false) }
  }
  throw invalid("\(field) must be YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS±HH:MM")
}

func optionalText(_ value: Any?, _ field: String) throws -> String? {
  guard let value, !(value is NSNull) else { return nil }
  guard let text = value as? String else { throw invalid("\(field) must be a string") }
  let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
  return trimmed.isEmpty ? nil : trimmed
}

func requiredText(_ value: Any?, _ field: String) throws -> String {
  guard let text = try optionalText(value, field) else { throw invalid("\(field) must be a non-empty string") }
  return text
}

func clip(_ text: String?, _ max: Int) -> String? {
  guard let text, !text.isEmpty else { return nil }
  return text.count > max ? String(text.prefix(max - 1)) + "…" : text
}

// MARK: EventKit

nonisolated(unsafe) let store = EKEventStore()

func requireAccess(_ type: EKEntityType) async throws {
  if EKEventStore.authorizationStatus(for: type) == .fullAccess { return }
  let name = type == .event ? "日历" : "提醒事项"
  let status = EKEventStore.authorizationStatus(for: type)
  if status != .denied && status != .restricted {
    let granted = type == .event ? try await store.requestFullAccessToEvents() : try await store.requestFullAccessToReminders()
    if granted {
      store.reset()
      return
    }
  }
  throw HelperError(code: "permission_denied", message: "没有\(name)的完整访问权限。请在“系统设置 → 隐私与安全性 → \(name)”中允许“Personal Agent 助手”，然后重试。")
}

func pickCalendar(_ name: String?, among calendars: [EKCalendar], fallback: EKCalendar?, kind: String) throws -> EKCalendar {
  let writable = calendars.filter { $0.allowsContentModifications }
  if let name {
    if let match = writable.first(where: { $0.title == name }) { return match }
    throw HelperError(code: "not_found", message: "没有名为“\(name)”的可写\(kind)。可用：\(writable.map(\.title).joined(separator: "、"))")
  }
  guard let fallback else { throw HelperError(code: "not_found", message: "没有默认\(kind)，请指定一个。") }
  return fallback
}

func calendarViews(_ calendars: [EKCalendar]) -> [[String: Any]] {
  calendars.map { ["title": $0.title, "writable": $0.allowsContentModifications] }
}

// Repeat rules come in as {frequency, interval?, until? | count?} or "none" (remove).
enum RepeatChange { case keep, clear, set(EKRecurrenceRule) }

func repeatChange(_ value: Any?) throws -> RepeatChange {
  guard let value, !(value is NSNull) else { return .keep }
  if let text = value as? String, text == "none" { return .clear }
  guard let spec = value as? [String: Any] else { throw invalid("repeat must be {frequency, interval?, until?, count?} or \"none\"") }
  let frequency: EKRecurrenceFrequency
  switch spec["frequency"] as? String {
  case "daily": frequency = .daily
  case "weekly": frequency = .weekly
  case "monthly": frequency = .monthly
  case "yearly": frequency = .yearly
  default: throw invalid("repeat.frequency must be daily, weekly, monthly or yearly")
  }
  let interval = (spec["interval"] as? Int) ?? 1
  guard (1...99).contains(interval) else { throw invalid("repeat.interval must be 1 to 99") }
  var end: EKRecurrenceEnd?
  if spec["until"] != nil, !(spec["until"] is NSNull) {
    let until = try parseWhen(spec["until"], "repeat.until")
    // A day means through the end of that day.
    end = EKRecurrenceEnd(end: until.dayOnly ? Calendar.current.date(bySettingHour: 23, minute: 59, second: 59, of: until.date)! : until.date)
  } else if let count = spec["count"] as? Int {
    guard (1...999).contains(count) else { throw invalid("repeat.count must be 1 to 999") }
    end = EKRecurrenceEnd(occurrenceCount: count)
  }
  return .set(EKRecurrenceRule(recurrenceWith: frequency, interval: interval, end: end))
}

func repeatView(_ item: EKCalendarItem) -> [String: Any]? {
  guard let rule = item.recurrenceRules?.first else { return nil }
  let names: [EKRecurrenceFrequency: String] = [.daily: "daily", .weekly: "weekly", .monthly: "monthly", .yearly: "yearly"]
  var view: [String: Any] = ["frequency": names[rule.frequency] ?? "custom", "interval": rule.interval]
  if let date = rule.recurrenceEnd?.endDate { view["until"] = dayFormatter.string(from: date) }
  if let count = rule.recurrenceEnd?.occurrenceCount, count > 0 { view["count"] = count }
  return view
}

func eventView(_ event: EKEvent) -> [String: Any] {
  var view: [String: Any] = [
    "id": event.eventIdentifier ?? "",
    "external_id": event.calendarItemExternalIdentifier ?? "",
    "title": event.title ?? "",
    "all_day": event.isAllDay,
    "calendar": event.calendar?.title ?? "",
    "recurring": event.hasRecurrenceRules,
  ]
  if event.isAllDay {
    view["start"] = dayFormatter.string(from: event.startDate)
    view["end"] = dayFormatter.string(from: event.endDate.addingTimeInterval(-1))
  } else {
    view["start"] = localOutput.string(from: event.startDate)
    view["end"] = localOutput.string(from: event.endDate)
  }
  if let location = clip(event.location, 200) { view["location"] = location }
  if let notes = clip(event.notes, 400) { view["notes"] = notes }
  if let rule = repeatView(event) { view["repeat"] = rule }
  return view
}

func reminderView(_ reminder: EKReminder) -> [String: Any] {
  var view: [String: Any] = ["title": reminder.title ?? "", "list": reminder.calendar?.title ?? "", "id": reminder.calendarItemIdentifier, "external_id": reminder.calendarItemExternalIdentifier ?? ""]
  if let rule = repeatView(reminder) { view["repeat"] = rule }
  if let due = reminder.dueDateComponents, let date = Calendar.current.date(from: due) {
    view["due"] = due.hour == nil ? dayFormatter.string(from: date) : localOutput.string(from: date)
  }
  if let notes = clip(reminder.notes, 400) { view["notes"] = notes }
  switch reminder.priority {
  case 1...4: view["priority"] = "high"
  case 5: view["priority"] = "medium"
  case 6...9: view["priority"] = "low"
  default: break
  }
  return view
}

func calendarEvents(_ input: [String: Any]) async throws -> [String: Any] {
  try await requireAccess(.event)
  let start = try parseWhen(input["start"], "start")
  var end = try parseWhen(input["end"], "end")
  // A day-only end means "through that day".
  if end.dayOnly { end.date = Calendar.current.date(byAdding: .day, value: 1, to: end.date)! }
  guard end.date > start.date else { throw invalid("end must be after start") }
  guard end.date.timeIntervalSince(start.date) <= 62 * 86400 else { throw invalid("the range must be at most 62 days") }
  let all = store.calendars(for: .event)
  var chosen: [EKCalendar]?
  if let names = input["calendars"] as? [String], !names.isEmpty {
    chosen = all.filter { names.contains($0.title) }
    if chosen!.isEmpty { throw HelperError(code: "not_found", message: "没有这些日历：\(names.joined(separator: "、"))。可用：\(all.map(\.title).joined(separator: "、"))") }
  }
  let events = store.events(matching: store.predicateForEvents(withStart: start.date, end: end.date, calendars: chosen))
    .sorted { $0.startDate < $1.startDate }
  let limit = 200
  return ["events": events.prefix(limit).map(eventView), "truncated": events.count > limit, "calendars": calendarViews(all)]
}

func calendarCreate(_ input: [String: Any]) async throws -> [String: Any] {
  try await requireAccess(.event)
  let start = try parseWhen(input["start"], "start")
  let end = try parseWhen(input["end"], "end")
  let allDay = (input["all_day"] as? Bool) ?? (start.dayOnly && end.dayOnly)
  guard allDay ? end.date >= start.date : end.date > start.date else { throw invalid("end must be after start") }
  let event = EKEvent(eventStore: store)
  event.title = try requiredText(input["title"], "title")
  event.isAllDay = allDay
  event.startDate = start.date
  event.endDate = end.date
  event.location = try optionalText(input["location"], "location")
  event.notes = try optionalText(input["notes"], "notes")
  event.calendar = try pickCalendar(try optionalText(input["calendar"], "calendar"), among: store.calendars(for: .event), fallback: store.defaultCalendarForNewEvents, kind: "日历")
  if let minutes = input["alert_minutes"] as? Int, minutes >= 0 {
    event.addAlarm(EKAlarm(relativeOffset: TimeInterval(-minutes * 60)))
  }
  if case .set(let rule) = try repeatChange(input["repeat"]) { event.recurrenceRules = [rule] }
  // The same request sent twice must not make two events.
  let near = store.events(matching: store.predicateForEvents(withStart: start.date.addingTimeInterval(-60), end: start.date.addingTimeInterval(60), calendars: [event.calendar]))
  if let same = near.first(where: { $0.title == event.title && abs($0.startDate.timeIntervalSince(start.date)) < 60 && $0.isAllDay == allDay }) {
    return ["created": false, "duplicate": true, "reason": "an event with this title already starts at this time in this calendar", "event": eventView(same)]
  }
  try store.save(event, span: .futureEvents, commit: true)
  return ["created": true, "event": eventView(event)]
}

// Changes one event, or with span "future" a repeating event from this occurrence on. "occurrence"
// (the start of the occurrence, as calendar_events returns it) picks the occurrence of a repeating
// event; a repeating event needs an explicit span. Moving only the start keeps the duration.
/// The event (or, with occurrence, that one occurrence of a repeating event) and the span a change
/// to it covers. A repeating event needs span "this" or "future".
func eventAndSpan(_ input: [String: Any]) throws -> (EKEvent, EKSpan) {
  let id = try requiredText(input["id"], "id")
  guard let first = store.event(withIdentifier: id) else { throw HelperError(code: "not_found", message: "找不到这个日程，它可能已被删除。先用 calendar_events 查最新的 id。") }
  var event: EKEvent = first
  if let occurrence = try optionalText(input["occurrence"], "occurrence") {
    let when = try parseWhen(occurrence, "occurrence")
    let window = store.predicateForEvents(withStart: when.date.addingTimeInterval(-60), end: when.date.addingTimeInterval(when.dayOnly ? 86400 : 60), calendars: [first.calendar])
    guard let match = store.events(matching: window).first(where: { $0.eventIdentifier == id }) else { throw HelperError(code: "not_found", message: "这个日程在 \(occurrence) 没有这一次。") }
    event = match
  }
  guard event.calendar.allowsContentModifications else { throw invalid("日历“\(event.calendar.title)”不能修改") }
  let spanName = try optionalText(input["span"], "span")
  if event.hasRecurrenceRules && spanName == nil { throw invalid("this event repeats: pass span \"this\" (only this occurrence) or \"future\" (this and later occurrences)") }
  switch spanName {
  case nil, "this": return (event, .thisEvent)
  case "future": return (event, .futureEvents)
  default: throw invalid("span must be this or future")
  }
}

func calendarUpdate(_ input: [String: Any]) async throws -> [String: Any] {
  try await requireAccess(.event)
  let (event, span) = try eventAndSpan(input)
  let before = eventView(event)
  if let title = try optionalText(input["title"], "title") { event.title = title }
  if input.keys.contains("location") { event.location = try optionalText(input["location"], "location") }
  if input.keys.contains("notes") { event.notes = try optionalText(input["notes"], "notes") }
  if let allDay = input["all_day"] as? Bool { event.isAllDay = allDay }
  let duration = event.endDate.timeIntervalSince(event.startDate)
  if input["start"] != nil, !(input["start"] is NSNull) {
    event.startDate = try parseWhen(input["start"], "start").date
    if input["end"] == nil || input["end"] is NSNull { event.endDate = event.startDate.addingTimeInterval(duration) }
  }
  if input["end"] != nil, !(input["end"] is NSNull) { event.endDate = try parseWhen(input["end"], "end").date }
  guard event.isAllDay ? event.endDate >= event.startDate : event.endDate > event.startDate else { throw invalid("end must be after start") }
  switch try repeatChange(input["repeat"]) {
  case .keep: break
  case .clear: event.recurrenceRules = nil
  case .set(let rule): event.recurrenceRules = [rule]
  }
  try store.save(event, span: span, commit: true)
  return ["updated": true, "span": span == .futureEvents ? "future" : "this", "before": before, "event": eventView(event)]
}

/// Delete one event, one occurrence ("this") or this and every later occurrence ("future"; on the
/// first occurrence that is the whole series). The caller has already had the user confirm.
func calendarDelete(_ input: [String: Any]) async throws -> [String: Any] {
  try await requireAccess(.event)
  let (event, span) = try eventAndSpan(input)
  let before = eventView(event)
  try store.remove(event, span: span, commit: true)
  return ["deleted": true, "span": span == .futureEvents ? "future" : "this", "event": before]
}

func remindersList(_ input: [String: Any]) async throws -> [String: Any] {
  try await requireAccess(.reminder)
  let lists = store.calendars(for: .reminder)
  var chosen: [EKCalendar]?
  if let name = try optionalText(input["list"], "list") {
    chosen = lists.filter { $0.title == name }
    if chosen!.isEmpty { throw HelperError(code: "not_found", message: "没有名为“\(name)”的提醒列表。可用：\(lists.map(\.title).joined(separator: "、"))") }
  }
  var dueBefore: Date?
  if input["due_before"] != nil, !(input["due_before"] is NSNull) {
    let when = try parseWhen(input["due_before"], "due_before")
    dueBefore = when.dayOnly ? Calendar.current.date(byAdding: .day, value: 1, to: when.date) : when.date
  }
  let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: dueBefore, calendars: chosen)
  let reminders: [EKReminder] = await withCheckedContinuation { continuation in
    store.fetchReminders(matching: predicate) { continuation.resume(returning: $0 ?? []) }
  }
  let dueOf = { (reminder: EKReminder) in reminder.dueDateComponents.flatMap { Calendar.current.date(from: $0) } ?? .distantFuture }
  let sorted = reminders.sorted { dueOf($0) < dueOf($1) }
  let limit = 200
  return ["reminders": sorted.prefix(limit).map(reminderView), "truncated": sorted.count > limit, "lists": calendarViews(lists)]
}

/// Sets or clears the due time. Earlier time alarms are removed first, so a moved reminder never
/// rings at its old time; a timed due gets an alarm, which is what rings on iPhone, Watch and Mac.
func setDue(_ reminder: EKReminder, _ value: Any?) throws {
  for alarm in reminder.alarms ?? [] where alarm.absoluteDate != nil { reminder.removeAlarm(alarm) }
  guard let value, !(value is NSNull) else { reminder.dueDateComponents = nil; return }
  let due = try parseWhen(value, "due")
  if due.dayOnly {
    reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day], from: due.date)
  } else {
    var parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: due.date)
    parts.timeZone = .current
    reminder.dueDateComponents = parts
    reminder.addAlarm(EKAlarm(absoluteDate: due.date))
  }
}

func openReminders(in calendars: [EKCalendar]?) async -> [EKReminder] {
  let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
  return await withCheckedContinuation { continuation in
    store.fetchReminders(matching: predicate) { continuation.resume(returning: $0 ?? []) }
  }
}

func remindersCreate(_ input: [String: Any]) async throws -> [String: Any] {
  try await requireAccess(.reminder)
  let reminder = EKReminder(eventStore: store)
  reminder.title = try requiredText(input["title"], "title")
  reminder.notes = try optionalText(input["notes"], "notes")
  reminder.calendar = try pickCalendar(try optionalText(input["list"], "list"), among: store.calendars(for: .reminder), fallback: store.defaultCalendarForNewReminders(), kind: "提醒列表")
  if input["due"] != nil, !(input["due"] is NSNull) { try setDue(reminder, input["due"]) }
  if case .set(let rule) = try repeatChange(input["repeat"]) {
    guard reminder.dueDateComponents != nil else { throw invalid("a repeating reminder needs a due date") }
    reminder.recurrenceRules = [rule]
  }
  // The same request sent twice must not make two reminders.
  let due = reminderView(reminder)["due"] as? String
  if let same = await openReminders(in: [reminder.calendar]).first(where: { $0.title == reminder.title && (reminderView($0)["due"] as? String) == due }) {
    return ["created": false, "duplicate": true, "reason": "an open reminder with this title and due time is already in this list", "reminder": reminderView(same)]
  }
  try store.save(reminder, commit: true)
  return ["created": true, "reminder": reminderView(reminder)]
}

// Changes a reminder's title, notes, due time or repeat rule; "clear_due" removes the due time.
// With "list", it refuses a reminder from any other list.
func remindersUpdate(_ input: [String: Any]) async throws -> [String: Any] {
  try await requireAccess(.reminder)
  let reminder = try reminderById(input)
  if let expected = try optionalText(input["list"], "list"), reminder.calendar?.title != expected { throw invalid("这条提醒不在“\(expected)”列表里") }
  guard reminder.calendar?.allowsContentModifications ?? false else { throw invalid("提醒列表“\(reminder.calendar?.title ?? "")”不能修改") }
  let before = completedView(reminder)
  if let title = try optionalText(input["title"], "title") { reminder.title = title }
  if input.keys.contains("notes") { reminder.notes = try optionalText(input["notes"], "notes") }
  if (input["clear_due"] as? Bool) == true { try setDue(reminder, nil) }
  else if input["due"] != nil, !(input["due"] is NSNull) { try setDue(reminder, input["due"]) }
  switch try repeatChange(input["repeat"]) {
  case .keep: break
  case .clear: reminder.recurrenceRules = nil
  case .set(let rule):
    guard reminder.dueDateComponents != nil else { throw invalid("a repeating reminder needs a due date") }
    reminder.recurrenceRules = [rule]
  }
  if reminder.dueDateComponents == nil, reminder.hasRecurrenceRules { reminder.recurrenceRules = nil }
  try store.save(reminder, commit: true)
  return ["updated": true, "before": before, "reminder": completedView(reminder)]
}

// By "external_id" (stable across iCloud syncs; what tasks keep) or by "id" (this Mac's identifier).
func reminderById(_ input: [String: Any]) throws -> EKReminder {
  if let external = try optionalText(input["external_id"], "external_id") {
    let items = store.calendarItems(withExternalIdentifier: external).compactMap { $0 as? EKReminder }
    guard let reminder = items.first(where: { !$0.isCompleted }) ?? items.first else {
      throw HelperError(code: "not_found", message: "找不到这条提醒，它可能已被删除。")
    }
    return reminder
  }
  let id = try requiredText(input["id"], "id")
  guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else {
    throw HelperError(code: "not_found", message: "找不到这条提醒（id \(id)）。先用 reminders_list 查最新的 id。")
  }
  return reminder
}

func completedView(_ reminder: EKReminder) -> [String: Any] {
  var view = reminderView(reminder)
  view["completed"] = reminder.isCompleted
  return view
}

func remindersGet(_ input: [String: Any]) async throws -> [String: Any] {
  try await requireAccess(.reminder)
  return ["reminder": completedView(try reminderById(input))]
}

// Marks a reminder done, which also stops its alarm. Nothing is deleted; unchecking it in
// Reminders undoes this. With "list", it refuses a reminder from any other list.
func remindersComplete(_ input: [String: Any]) async throws -> [String: Any] {
  try await requireAccess(.reminder)
  let reminder = try reminderById(input)
  if reminder.isCompleted { return ["completed": false, "reason": "already completed", "reminder": completedView(reminder)] }
  if let expected = try optionalText(input["list"], "list"), reminder.calendar?.title != expected {
    throw invalid("这条提醒不在“\(expected)”列表里")
  }
  reminder.isCompleted = true
  try store.save(reminder, commit: true)
  return ["completed": true, "reminder": completedView(reminder)]
}

// MARK: Notes and Mail (Apple Events through JavaScript for Automation)

struct ScriptedApp {
  let code: String
  let name: String
  let prelude: String
}

let notesApp = ScriptedApp(code: "notes", name: "备忘录", prelude: """
  const Notes = Application('Notes');
  const trash = new Set(['Recently Deleted', '最近删除']);
  const folderOf = note => { try { return note.container().name(); } catch (e) { return ''; } };
  """)

let mailApp = ScriptedApp(code: "mail", name: "邮件", prelude: """
  const Mail = Application('Mail');
  const names = list => list.map(item => item.name()).join('、');
  const accountNamed = name => {
    const account = Mail.accounts().find(item => item.name() === name);
    if (!account) throw new Error('没有名为“' + name + '”的邮件账户。可用：' + names(Mail.accounts()));
    if (!account.enabled()) throw new Error('邮件账户“' + name + '”在“邮件”中已停用。');
    return account;
  };
  // An account's inbox, or the mailbox with that name (exact first, then ignoring case).
  const mailboxOf = (account, name) => {
    if (name === undefined) return Mail.inbox.mailboxes().find(box => box.account().name() === account.name());
    const boxes = account.mailboxes(), lower = name.toLowerCase();
    return boxes.find(box => box.name() === name) ?? boxes.find(box => box.name().toLowerCase() === lower);
  };
  """)

func runScript(_ app: ScriptedApp, _ body: String) throws -> Any {
  let source = """
  (() => {
    const pad = n => String(Math.floor(Math.abs(n))).padStart(2, '0');
    const iso = d => { const z = -d.getTimezoneOffset(); return new Date(d.getTime() + z * 60000).toISOString().slice(0, 19) + (z >= 0 ? '+' : '-') + pad(z / 60) + ':' + pad(z % 60); };
    \(app.prelude)
    \(body)
  })()
  """
  let script = OSAScript(source: source, language: OSALanguage(forName: "JavaScript"))
  var error: NSDictionary?
  guard let result = script.executeAndReturnError(&error) else {
    let number = (error?[OSAScriptErrorNumberKey] as? NSNumber)?.intValue
    if number == -1743 || number == -1744 {
      throw HelperError(code: "permission_denied", message: "没有控制“\(app.name)”的权限。请在“系统设置 → 隐私与安全性 → 自动化”中允许“Personal Agent 助手”控制“\(app.name)”，然后重试。")
    }
    let message = (error?[OSAScriptErrorMessageKey] as? String).map { $0.replacingOccurrences(of: "Error: ", with: "") }
    throw HelperError(code: "\(app.code)_failed", message: message ?? "\(app.name)脚本执行失败")
  }
  guard let text = result.stringValue, let data = text.data(using: .utf8) else { throw HelperError(code: "\(app.code)_failed", message: "\(app.name)没有返回结果") }
  return try JSONSerialization.jsonObject(with: data)
}

func jsLiteral(_ value: String) throws -> String {
  String(data: try JSONSerialization.data(withJSONObject: [value]), encoding: .utf8)!.dropFirst().dropLast().description
}

func notesSearch(_ input: [String: Any]) throws -> Any {
  let query = try requiredText(input["query"], "query")
  let limit = min(max((input["limit"] as? Int) ?? 10, 1), 20)
  return try runScript(notesApp, """
    const query = \(try jsLiteral(query)), limit = \(limit), lower = query.toLowerCase();
    const found = Notes.notes.whose({ _or: [{ name: { _contains: query } }, { plaintext: { _contains: query } }] })();
    const notes = [];
    let more = false;
    for (const note of found) {
      const folder = folderOf(note);
      if (trash.has(folder)) continue;
      if (notes.length === limit) { more = true; break; }
      let text = '';
      try { text = note.plaintext(); } catch (e) {}
      const at = text.toLowerCase().indexOf(lower), from = Math.max(0, at - 60);
      notes.push({ id: note.id(), title: note.name(), folder, modified: iso(note.modificationDate()), snippet: (at < 0 ? text.slice(0, 160) : text.slice(from, from + 200)).replace(/\\s+/g, ' ').trim() });
    }
    return JSON.stringify({ notes, truncated: more });
  """)
}

func notesRead(_ input: [String: Any]) throws -> Any {
  let id = try requiredText(input["id"], "id")
  return try runScript(notesApp, """
    const note = Notes.notes.byId(\(try jsLiteral(id)));
    let text;
    try { text = note.plaintext(); } catch (e) { throw new Error('找不到这条备忘录，或它已被锁定'); }
    const max = 20000;
    return JSON.stringify({ id: note.id(), title: note.name(), folder: folderOf(note), modified: iso(note.modificationDate()), text: text.slice(0, max), truncated: text.length > max });
  """)
}

// Mail is read with whole-mailbox property fetches (one Apple Event per property), which stays
// fast for thousands of messages; reading a message's content does not mark it as read.

func mailAccounts(_ input: [String: Any]) throws -> Any {
  try runScript(mailApp, """
    const accounts = Mail.accounts().map(account => {
      const view = { name: account.name(), enabled: account.enabled(), addresses: account.emailAddresses() };
      if (!view.enabled) return view;
      const inbox = mailboxOf(account);
      const boxes = account.mailboxes, unread = boxes.unreadCount();
      view.inbox = inbox ? inbox.name() : null;
      view.mailboxes = boxes.name().map((name, i) => ({ name, unread: unread[i] }));
      return view;
    });
    return JSON.stringify({ accounts });
  """)
}

func mailList(_ input: [String: Any]) throws -> Any {
  let account = try optionalText(input["account"], "account")
  let mailbox = try optionalText(input["mailbox"], "mailbox")
  let query = try optionalText(input["query"], "query")
  let unreadOnly = (input["unread_only"] as? Bool) ?? false
  var since: Double?
  if input["since"] != nil, !(input["since"] is NSNull) { since = try parseWhen(input["since"], "since").date.timeIntervalSince1970 * 1000 }
  let limit = min(max((input["limit"] as? Int) ?? 20, 1), 50)
  let literal = { (value: String?) in try value.map(jsLiteral) ?? "undefined" }
  return try runScript(mailApp, """
    const account = \(try literal(account)), mailbox = \(try literal(mailbox)), query = \(try literal(query));
    const unreadOnly = \(unreadOnly), since = \(since.map { String($0) } ?? "undefined"), limit = \(limit);
    const accounts = account === undefined ? Mail.accounts().filter(item => item.enabled()) : [accountNamed(account)];
    const boxes = accounts.map(item => mailboxOf(item, mailbox)).filter(Boolean);
    if (boxes.length === 0) {
      const where = account === undefined ? '已启用的账户' : '账户“' + account + '”';
      throw new Error(where + '里没有' + (mailbox === undefined ? '收件箱' : '名为“' + mailbox + '”的邮箱') + '。可用：' + accounts.map(item => item.name() + '：' + names(item.mailboxes())).join('；'));
    }
    const lower = query?.toLowerCase(), found = [], searched = [];
    for (const box of boxes) {
      const owner = box.account().name(), name = box.name(), messages = box.messages;
      const ids = messages.id(), dates = messages.dateReceived(), subjects = messages.subject(), senders = messages.sender();
      const read = messages.readStatus(), flagged = messages.flaggedStatus(), headers = messages.messageId();
      searched.push({ account: owner, mailbox: name, messages: ids.length });
      ids.forEach((id, i) => {
        const time = dates[i] ? dates[i].getTime() : 0;
        if (since !== undefined && time < since) return;
        if (unreadOnly && read[i]) return;
        if (lower !== undefined && !String(subjects[i] ?? '').toLowerCase().includes(lower) && !String(senders[i] ?? '').toLowerCase().includes(lower)) return;
        found.push({ time, view: { account: owner, mailbox: name, id, message_id: headers[i] ?? null, from: senders[i] ?? '', subject: subjects[i] ?? '', received: dates[i] ? iso(dates[i]) : null, read: read[i], ...flagged[i] ? { flagged: true } : {} } });
      });
    }
    found.sort((a, b) => b.time - a.time);
    return JSON.stringify({ messages: found.slice(0, limit).map(item => item.view), matched: found.length, truncated: found.length > limit, searched });
  """)
}

func mailRead(_ input: [String: Any]) throws -> Any {
  let account = try requiredText(input["account"], "account")
  let mailbox = try requiredText(input["mailbox"], "mailbox")
  guard let id = input["message_id"] as? Int else { throw invalid("message_id must be an integer") }
  return try runScript(mailApp, """
    const box = mailboxOf(accountNamed(\(try jsLiteral(account))), \(try jsLiteral(mailbox)));
    const message = box && box.messages.byId(\(id));
    let subject;
    try { subject = message.subject(); } catch (e) { throw new Error('找不到这封邮件，它可能已被移动或删除。'); }
    const people = list => { try { const names = list.name(), addresses = list.address(); return addresses.map((address, i) => names[i] ? names[i] + ' <' + address + '>' : address); } catch (e) { return []; } };
    let attachments = [];
    try { attachments = message.mailAttachments.name(); } catch (e) {}
    const text = String(message.content() ?? '').replace(/\\r\\n?/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
    const max = 20000, received = message.dateReceived();
    return JSON.stringify({ account: box.account().name(), mailbox: box.name(), message_id: message.messageId(), from: message.sender(), to: people(message.toRecipients), cc: people(message.ccRecipients), subject, received: received ? iso(received) : null, read: message.readStatus(), attachments, text: text.slice(0, max), truncated: text.length > max });
  """)
}

// A draft is saved to the account's Drafts mailbox and never sent; the user reviews and sends it in
// Mail. An invisible compose window is not filed when closed, so the window opens, is saved and
// closed, and success is reported only once Drafts holds one more message with that subject.
func mailDraft(_ input: [String: Any]) throws -> Any {
  let account = try optionalText(input["account"], "account")
  let subject = try requiredText(input["subject"], "subject")
  let body = try requiredText(input["body"], "body")
  let addresses = { (field: String) throws -> [String] in
    guard let list = input[field] else { return [] }
    guard let items = list as? [String], items.count <= 20 else { throw invalid("\(field) must be a list of at most 20 email addresses") }
    return try items.map { item in
      let address = item.trimmingCharacters(in: .whitespaces)
      guard address.range(of: #"^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$"#, options: .regularExpression) != nil else { throw invalid("\(field) has an invalid email address: \(item)") }
      return address
    }
  }
  let to = try addresses("to"), cc = try addresses("cc")
  let literal = { (value: String?) in try value.map(jsLiteral) ?? "undefined" }
  let list = { (items: [String]) in String(data: try JSONSerialization.data(withJSONObject: items), encoding: .utf8)! }
  return try runScript(mailApp, """
    const account = \(try literal(account)), to = \(try list(to)), cc = \(try list(cc));
    const from = account === undefined ? undefined : accountNamed(account);
    const subject = \(try jsLiteral(subject));
    const message = Mail.OutgoingMessage({ subject, content: \(try jsLiteral(body)), visible: true });
    Mail.outgoingMessages.push(message);
    if (from) message.sender = from.emailAddresses()[0];
    to.forEach(address => message.toRecipients.push(Mail.ToRecipient({ address })));
    cc.forEach(address => message.ccRecipients.push(Mail.CcRecipient({ address })));
    const sender = message.sender();
    const drafts = () => Mail.draftsMailbox.messages.whose({ subject })().length, before = drafts();
    message.save();
    Mail.close(message, { saving: 'yes' });
    let found = 0;
    for (let tries = 0; tries < 20 && found <= before; tries++) {
      found = drafts();
      if (found <= before) delay(0.5);
    }
    if (found <= before) throw new Error('草稿没有出现在“草稿”邮箱里，可能没有保存成功；请在“邮件”里检查。');
    return JSON.stringify({ saved: true, sent: false, from: sender, to, cc, subject });
  """)
}

// A reply built as a new draft: "Re:" subject, the original sender (and with reply_all the other
// recipients, minus the user's own addresses), the assistant's text, then the quoted original. Mail
// does not let a script replace the text of its own reply window, so the thread headers are not
// set; Mail, Gmail and Outlook group the reply with the conversation by its subject. It is sent from
// the account that received the original, saved to Drafts, checked there, and never sent.
func mailReplyDraft(_ input: [String: Any]) throws -> Any {
  let account = try requiredText(input["account"], "account")
  let mailbox = try requiredText(input["mailbox"], "mailbox")
  guard let id = input["message_id"] as? Int else { throw invalid("message_id must be an integer") }
  let body = try requiredText(input["body"], "body")
  let replyAll = (input["reply_all"] as? Bool) ?? false
  return try runScript(mailApp, """
    const owner = accountNamed(\(try jsLiteral(account)));
    const box = mailboxOf(owner, \(try jsLiteral(mailbox)));
    const original = box && box.messages.byId(\(id));
    let first;
    try { first = String(original.subject() ?? ''); } catch (e) { throw new Error('找不到这封邮件，它可能已被移动或删除。'); }
    const subject = /^re:/i.test(first.trim()) ? first.trim() : 'Re: ' + first.trim();
    const address = text => (/<([^>]+)>/.exec(text)?.[1] ?? String(text)).trim();
    const own = new Set(owner.emailAddresses().map(item => item.toLowerCase()));
    const sender = String(original.sender() ?? '');
    let replyTo = '';
    try { replyTo = String(original.replyTo() ?? ''); } catch (e) {}
    const listed = list => { try { return list.address(); } catch (e) { return []; } };
    const to = [address(replyTo || sender)];
    const cc = [];
    if (\(replyAll)) {
      for (const item of listed(original.toRecipients)) if (!own.has(item.toLowerCase()) && !to.includes(item)) to.push(item);
      for (const item of listed(original.ccRecipients)) if (!own.has(item.toLowerCase()) && !to.includes(item) && !cc.includes(item)) cc.push(item);
    }
    const text = String(original.content() ?? '').replace(/\\r\\n?/g, '\\n').trim();
    const lines = text.split('\\n'), kept = lines.slice(0, 200);
    const quote = kept.map(line => '> ' + line).join('\\n') + (lines.length > kept.length ? '\\n> …' : '');
    const received = original.dateReceived();
    const content = \(try jsLiteral(body)) + '\\n\\n' + (received ? iso(received).replace('T', ' ').slice(0, 16) + ' ' : '') + sender + ' 写道：\\n' + quote;
    const message = Mail.OutgoingMessage({ subject, content, visible: true });
    Mail.outgoingMessages.push(message);
    message.sender = owner.emailAddresses()[0];
    to.forEach(item => message.toRecipients.push(Mail.ToRecipient({ address: item })));
    cc.forEach(item => message.ccRecipients.push(Mail.CcRecipient({ address: item })));
    const from = message.sender();
    const drafts = () => Mail.draftsMailbox.messages.whose({ subject })().length, before = drafts();
    message.save();
    Mail.close(message, { saving: 'yes' });
    let found = 0;
    for (let tries = 0; tries < 20 && found <= before; tries++) {
      found = drafts();
      if (found <= before) delay(0.5);
    }
    if (found <= before) throw new Error('回复草稿没有出现在“草稿”邮箱里，可能没有保存成功；请在“邮件”里检查。');
    return JSON.stringify({ saved: true, sent: false, reply_to: sender, from, to, cc, subject });
  """)
}

// A message's identity without its content: the Message-ID header (stable when the message moves),
// subject, sender and time. Tasks keep the header to recognize the same email again.
func mailMeta(_ input: [String: Any]) throws -> Any {
  let account = try requiredText(input["account"], "account")
  let mailbox = try requiredText(input["mailbox"], "mailbox")
  guard let id = input["message_id"] as? Int else { throw invalid("message_id must be an integer") }
  return try runScript(mailApp, """
    const box = mailboxOf(accountNamed(\(try jsLiteral(account))), \(try jsLiteral(mailbox)));
    const message = box && box.messages.byId(\(id));
    let subject;
    try { subject = message.subject(); } catch (e) { throw new Error('找不到这封邮件，它可能已被移动或删除。'); }
    const received = message.dateReceived();
    return JSON.stringify({ account: box.account().name(), mailbox: box.name(), id: \(id), message_id: message.messageId(), from: message.sender(), subject, received: received ? iso(received) : null });
  """)
}

// Whether the user has replied to a message: a sent message to the original sender after "since",
// whose subject carries the original's (and, when Mail exposes the headers, whose In-Reply-To or
// References name the original's Message-ID). Also counts drafts to that sender with that subject
// still waiting in Drafts, so a saved draft is never mistaken for a sent reply.
func mailReplyStatus(_ input: [String: Any]) throws -> Any {
  let subject = try requiredText(input["subject"], "subject")
  let to = try requiredText(input["to"], "to")
  let header = try optionalText(input["message_id"], "message_id")
  let account = try optionalText(input["account"], "account")
  var since: Double = 0
  if input["since"] != nil, !(input["since"] is NSNull) { since = try parseWhen(input["since"], "since").date.timeIntervalSince1970 * 1000 }
  let literal = { (value: String?) in try value.map(jsLiteral) ?? "undefined" }
  return try runScript(mailApp, """
    const core = \(try jsLiteral(subject)).replace(/^\\s*((re|fwd?|fw|回复|答复|转发)\\s*[:：]\\s*)+/i, '').trim();
    const want = (/<([^>]+)>/.exec(\(try jsLiteral(to)))?.[1] ?? \(try jsLiteral(to))).trim().toLowerCase();
    const header = \(try literal(header)), account = \(try literal(account)), since = \(since);
    const own = account === undefined ? undefined : new Set(accountNamed(account).emailAddresses().map(item => item.toLowerCase()));
    const address = text => (/<([^>]+)>/.exec(String(text))?.[1] ?? String(text)).trim().toLowerCase();
    const recipients = message => { try { return message.toRecipients.address().concat(message.ccRecipients.address()).map(item => item.toLowerCase()); } catch (e) { return []; } };
    const candidates = box => { try { return box.messages.whose({ subject: { _contains: core } })(); } catch (e) { return []; } };
    let replied = null;
    // The shared Sent mailbox, plus each account's own sent folder (Exchange keeps "Sent Items" or
    // "已发送邮件"), in case Mail does not file it under the shared one.
    const sentBoxes = [Mail.sentMailbox];
    for (const item of account === undefined ? Mail.accounts().filter(one => one.enabled()) : [accountNamed(account)]) {
      try { for (const box of item.mailboxes()) if (/^(sent|sent mail|sent items|sent messages|已发送|已发送邮件|已傳送|寄件備份)$/i.test(box.name())) sentBoxes.push(box); } catch (e) {}
    }
    const seen = new Set(), sent = [];
    for (const box of sentBoxes) for (const message of candidates(box).slice(-40)) {
      let key; try { key = message.messageId(); } catch (e) { key = Math.random(); }
      if (!seen.has(key)) { seen.add(key); sent.push(message); }
    }
    for (const message of sent) {
      const at = message.dateSent();
      if (!at || at.getTime() < since) continue;
      if (!recipients(message).includes(want)) continue;
      if (own !== undefined && !own.has(address(message.sender()))) continue;
      let match = 'subject';
      if (header !== undefined) { try { if (String(message.allHeaders()).includes(header.replace(/^<|>$/g, ''))) match = 'header'; } catch (e) {} }
      if (!replied || at.getTime() > replied.time || match === 'header') replied = { time: at.getTime(), sent_at: iso(at), subject: message.subject(), match };
    }
    const drafts = candidates(Mail.draftsMailbox).filter(message => recipients(message).includes(want)).length;
    return JSON.stringify({ replied: replied !== null, ...replied ? { sent_at: replied.sent_at, sent_subject: replied.subject, match: replied.match } : {}, drafts, checked: { subject: core, to: want, sent_candidates: sent.length } });
  """)
}

// New notes go only into one folder of the default account, created on first use. Existing notes
// are never changed.
func notesCreate(_ input: [String: Any]) throws -> Any {
  let folder = try requiredText(input["folder"], "folder")
  let title = try requiredText(input["title"], "title")
  let body = try requiredText(input["body"], "body")
  let escape = { (text: String) in text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;") }
  let lines = body.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n").map { $0.isEmpty ? "<div><br></div>" : "<div>\(escape($0))</div>" }
  let html = "<div><h1>\(escape(title))</h1></div>" + lines.joined()
  return try runScript(notesApp, """
    const account = Notes.defaultAccount(), name = \(try jsLiteral(folder));
    let folder = account.folders.whose({ name })()[0];
    if (!folder) { folder = Notes.Folder({ name }); account.folders.push(folder); folder = account.folders.whose({ name })()[0]; }
    const note = Notes.Note({ body: \(try jsLiteral(html)) });
    folder.notes.push(note);
    const made = folder.notes.whose({ name: \(try jsLiteral(title)) })();
    const saved = made[made.length - 1];
    return JSON.stringify({ created: true, id: saved ? saved.id() : null, title: \(try jsLiteral(title)), folder: name, account: account.name() });
  """)
}

// MARK: Keychain (the assistant's password book)

// Passwords live in the login keychain as generic passwords under one service, so they are encrypted
// at rest and visible in Keychain Access. The account attribute is "<site> · <username>".
let keychainService = "io.github.alexz949.personal-agent"

func keychainKey(_ input: [String: Any]) throws -> (site: String, username: String, account: String) {
  let site = try requiredText(input["site"], "site")
  let username = try requiredText(input["username"], "username")
  guard !site.contains(" · "), !username.contains(" · ") else { throw invalid("site and username must not contain \" · \"") }
  return (site, username, "\(site) · \(username)")
}

func keychainFailure(_ status: OSStatus, _ what: String) -> HelperError {
  let text = (SecCopyErrorMessageString(status, nil) as String?) ?? "OSStatus \(status)"
  return HelperError(code: status == errSecItemNotFound ? "not_found" : "keychain", message: "\(what)：\(text)")
}

func keychainSave(_ input: [String: Any]) throws -> [String: Any] {
  let key = try keychainKey(input)
  guard let password = input["password"] as? String, !password.isEmpty else { throw invalid("password must be a non-empty string") }
  let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: keychainService, kSecAttrAccount as String: key.account]
  let attributes: [String: Any] = [
    kSecValueData as String: Data(password.utf8),
    kSecAttrLabel as String: "Personal Agent: \(key.site)",
    kSecAttrDescription as String: "Personal Agent 密码本",
  ]
  var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
  let replaced = status == errSecSuccess
  if status == errSecItemNotFound {
    var item = query
    for (name, value) in attributes { item[name] = value }
    status = SecItemAdd(item as CFDictionary, nil)
  }
  guard status == errSecSuccess else { throw keychainFailure(status, "没能存进钥匙串") }
  return ["saved": true, "replaced": replaced, "site": key.site, "username": key.username]
}

func keychainGet(_ input: [String: Any]) throws -> [String: Any] {
  let key = try keychainKey(input)
  let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: keychainService, kSecAttrAccount as String: key.account,
    kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne,
  ]
  var result: CFTypeRef?
  let status = SecItemCopyMatching(query as CFDictionary, &result)
  guard status == errSecSuccess, let data = result as? Data, let password = String(data: data, encoding: .utf8) else {
    throw keychainFailure(status == errSecSuccess ? errSecDecode : status, "没能从钥匙串取出")
  }
  return ["site": key.site, "username": key.username, "password": password]
}

func keychainList(_ input: [String: Any]) throws -> [String: Any] {
  let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: keychainService,
    kSecReturnAttributes as String: true, kSecMatchLimit as String: kSecMatchLimitAll,
  ]
  var result: CFTypeRef?
  let status = SecItemCopyMatching(query as CFDictionary, &result)
  if status == errSecItemNotFound { return ["entries": []] }
  guard status == errSecSuccess, let items = result as? [[String: Any]] else { throw keychainFailure(status, "没能列出钥匙串条目") }
  let entries: [[String: Any]] = items.compactMap { item in
    guard let account = item[kSecAttrAccount as String] as? String, let split = account.range(of: " · ") else { return nil }
    var entry: [String: Any] = ["site": String(account[..<split.lowerBound]), "username": String(account[split.upperBound...])]
    if let date = item[kSecAttrModificationDate as String] as? Date { entry["updated"] = dayFormatter.string(from: date) }
    return entry
  }.sorted { ($0["site"] as? String ?? "") < ($1["site"] as? String ?? "") }
  return ["entries": entries]
}

func keychainDelete(_ input: [String: Any]) throws -> [String: Any] {
  let key = try keychainKey(input)
  let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: keychainService, kSecAttrAccount as String: key.account]
  let status = SecItemDelete(query as CFDictionary)
  guard status == errSecSuccess else { throw keychainFailure(status, "没能从钥匙串删除") }
  return ["deleted": true, "site": key.site, "username": key.username]
}

// MARK: Dispatch

let arguments = CommandLine.arguments
// "@<path>": read the request from that file instead, so a password never sits in argv.
let requestText: String? = arguments.count >= 2 ? (arguments[1].hasPrefix("@") ? try? String(contentsOfFile: String(arguments[1].dropFirst()), encoding: .utf8) : arguments[1]) : nil
guard let raw = requestText?.data(using: .utf8),
      let request = (try? JSONSerialization.jsonObject(with: raw)) as? [String: Any],
      let op = request["op"] as? String else {
  reply(["ok": false, "code": "invalid_input", "message": "Personal Agent 助手只能由 DSH 插件调用。"])
}

do {
  let data: Any
  switch op {
  case "calendar.events": data = try await calendarEvents(request)
  case "calendar.create": data = try await calendarCreate(request)
  case "reminders.list": data = try await remindersList(request)
  case "reminders.create": data = try await remindersCreate(request)
  case "reminders.get": data = try await remindersGet(request)
  case "reminders.complete": data = try await remindersComplete(request)
  case "reminders.update": data = try await remindersUpdate(request)
  case "calendar.update": data = try await calendarUpdate(request)
  case "calendar.delete": data = try await calendarDelete(request)
  case "mail.meta": data = try mailMeta(request)
  case "mail.reply_status": data = try mailReplyStatus(request)
  case "notes.search": data = try notesSearch(request)
  case "notes.read": data = try notesRead(request)
  case "mail.accounts": data = try mailAccounts(request)
  case "mail.list": data = try mailList(request)
  case "mail.read": data = try mailRead(request)
  case "mail.draft": data = try mailDraft(request)
  case "mail.reply": data = try mailReplyDraft(request)
  case "notes.create": data = try notesCreate(request)
  case "keychain.save": data = try keychainSave(request)
  case "keychain.get": data = try keychainGet(request)
  case "keychain.list": data = try keychainList(request)
  case "keychain.delete": data = try keychainDelete(request)
  default: throw invalid("unknown op \(op)")
  }
  reply(["ok": true, "data": data])
} catch let error as HelperError {
  reply(["ok": false, "code": error.code, "message": error.message])
} catch {
  reply(["ok": false, "code": "failed", "message": error.localizedDescription])
}
