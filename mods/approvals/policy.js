const normalized = text => String(text ?? '').normalize('NFKC').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const proceed = choice => /^Yes,?\s*proceed(?:\s*\(y\))?$/i.test(normalized(choice.label));
const deny = choice => /^No,\s*and tell Codex what to do differently(?:\s*\(esc\))?$/i.test(normalized(choice.label));
const remembered = choice => /^Yes,?\s*and don'?t ask again for\s+\S/i.test(normalized(choice.label));
const broad = choice => /\b(?:all|any)\s+(?:commands?|tools?|actions?)\b|\ball future\b|\bbypass\b/i.test(normalized(`${choice.label} ${choice.description ?? ''}`));

export function chooseApproval(question, mode = 'once') {
  if (!question || !Array.isArray(question.choices) || !question.command) return null;
  const choices = question.choices;
  if (question.kind === 'multi' || choices.some(choice => choice.free || !Number.isInteger(choice.n) || choice.n < 1)) return null;
  if (choices.filter(deny).length !== 1) return null;
  const single = choices.filter(proceed);
  if (single.length !== 1) return null;
  if (question.kind === 'terminal-input') return single[0].n;
  if (mode === 'remember') {
    const scopes = choices.filter(remembered);
    if (scopes.length > 1) return null;
    if (scopes.length === 1 && !broad(scopes[0])) return scopes[0].n;
  }
  return single[0].n;
}
