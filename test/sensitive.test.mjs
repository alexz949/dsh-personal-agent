import test from 'node:test';
import assert from 'node:assert/strict';
import { sensitiveTool } from '../src/sensitive.js';
import { withLog } from '../src/log.js';

const exec = { agent: {}, signal: new AbortController().signal };

function fake(answer) {
  const asked = [];
  const questions = () => ({ ask: async request => { asked.push(request); return { answers: [{ id: 'confirm', ...answer }] }; } });
  return { tool: sensitiveTool({ questions }), asked };
}

test('sensitive_confirm asks on a card naming what and where, and says yes only for 允许', async () => {
  const yes = fake({ selected: ['允许'] });
  const result = await yes.tool.execute({ action: 'type_secret', what: 'Canvas 密码', where: 'Duke 登录页的密码栏', why: '登录 Canvas 下载课件' }, exec);
  assert.deepEqual(result, { approved: true, action: 'type_secret', what: 'Canvas 密码', where: 'Duke 登录页的密码栏' });
  const card = yes.asked[0].questions[0];
  assert.equal(card.question, '在「Duke 登录页的密码栏」填入Canvas 密码？');
  assert.deepEqual(card.options.map(option => option.label), ['允许', '取消']);
  assert.match(card.detail, /用途：登录 Canvas 下载课件\n具体的值不会显示在这张卡片上。\n这次允许只管这一次操作。/);

  const no = fake({ selected: ['取消'] });
  const refused = await no.tool.execute({ action: 'read_site_data', what: 'cookie', where: 'canvas.duke.edu' }, exec);
  assert.equal(refused.approved, false);
  assert.match(refused.reason, /do not do it/);
  assert.equal(no.asked[0].questions[0].question, '读取「canvas.duke.edu」的 cookie、登录信息或本地存储？');

  const change = await fake({ selected: [], custom: '只填用户名' }).tool.execute({ action: 'save_secret', what: 'GitHub token', where: 'Mnemon 记忆' }, exec);
  assert.deepEqual([change.approved, change.user_feedback], [false, '只填用户名']);
});

test('sensitive_confirm refuses vague requests, and without a card nothing is allowed', async () => {
  const { tool } = fake({ selected: ['允许'] });
  await assert.rejects(tool.execute({ action: 'type_secret', what: ' ', where: 'x' }, exec), /what and where/);
  await assert.rejects(tool.execute({ action: 'pay', what: 'x', where: 'y' }, exec), /action must be one of/);
  await assert.rejects(sensitiveTool().execute({ action: 'show_secret', what: 'API key', where: '对话' }, exec), /cannot ask the user to confirm/);
});

test('only approved sensitive actions reach the action log', async () => {
  const lines = [];
  const log = async (_tool, text) => { lines.push(text); };
  const [approved] = withLog([fake({ selected: ['允许'] }).tool], log);
  const [refused] = withLog([fake({ selected: ['取消'] }).tool], log);
  await approved.execute({ action: 'type_secret', what: '验证码', where: 'Duke 登录页' }, exec);
  await refused.execute({ action: 'show_secret', what: 'API key', where: '对话' }, exec);
  assert.deepEqual(lines, ['允许敏感操作：type_secret（验证码 → Duke 登录页）']);
});
