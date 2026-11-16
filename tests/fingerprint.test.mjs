import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256 } from '../mods/approvals/digest.js';
import { ApprovalController } from '../mods/approvals/controller.js';
import { MemoryJournal } from '../mods/approvals/state.js';
import { parseCodex } from '../mods/approvals/parsers/codex.js';
import { codexPrompt } from './fixtures/prompts.mjs';

test('portable request digests match SHA-256 for UTF-8 and boundary lengths',()=>{
  for(const value of ['', 'abc', '테스트 실행 🐑', 'x'.repeat(55),'x'.repeat(56),'x'.repeat(64),'x'.repeat(1000)])assert.equal(sha256(value),createHash('sha256').update(value).digest('hex'));
});
test('durable attempt and cancellation identifiers contain no command or choice text',async()=>{
  const marker='fictional-command-secret-marker';
  const question=parseCodex(codexPrompt({command:`echo ${marker}`}));
  const row={sessionKey:'fixture',episode:'1',address:'t1',agent:'codex',status:'blocked',question};
  const journal=new MemoryJournal();
  const controller=new ApprovalController({provider:{id:'native',list:async()=>[row],readQuestion:async()=>row,submit:async()=>({status:'delivered'})},journal});
  await controller.refresh();controller.cancel(row.sessionKey);await controller.flush();await controller.submit(row.sessionKey,1);
  const saved=JSON.stringify(await journal.entries());
  assert.ok(!saved.includes(marker));assert.ok(!saved.includes('Yes, proceed'));assert.ok(!saved.includes("don't ask again"));
});
