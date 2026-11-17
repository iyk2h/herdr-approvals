import { div } from 'gpui-kit';
import { Button, v_flex, h_flex } from 'gpui-base';
import { theme } from 'herdr';

export function button(id, label, onClick, {
  selected = false, disabled = false, variant = 'ghost', compact = false, grow = false, align = 'left',
} = {}) {
  const t = theme();
  const primary = variant === 'primary';
  const control = Button.new(id).min_w(0).px(compact ? 8 : 10).py(compact ? 6 : 9)
    .rounded(6).text_size(13).disabled(disabled).selected(selected)
    .text_color(primary ? t.solid_foreground || t.background : t.foreground)
    .on_click((_event, cx) => onClick(cx));
  if (grow) control.flex_1();
  if (primary) control.bg(t.solid || t.foreground);
  else if (selected) control.bg(t.selected || t.hover);
  else if (variant === 'secondary') control.bg(t.raised || t.surface);
  if (!primary) control.hover(style => style.bg(t.hover || t.raised || t.surface));
  const content = h_flex().w_full().min_w(0).items_center().gap(8);
  if (align === 'center') content.justify_center();
  else content.justify_start();
  content.child(typeof label === 'string' ? div().min_w(0).whitespace_normal().child(label) : label);
  return control.child(content);
}

const description = text => div().min_w(0).text_size(12).text_color(theme().muted).whitespace_normal().child(text);
const label = text => div().min_w(0).font_medium().whitespace_normal().child(text);
const separator = () => div().h(1).w_full().flex_none().bg(theme().border);

function setting(name, detail, control) {
  return v_flex().min_w(0).gap(8)
    .child(v_flex().min_w(0).gap(4).child(label(name)).child(description(detail)))
    .child(control);
}

function segmented(id, options, selected, onSelect, disabled) {
  const t = theme();
  return h_flex().w_full().min_w(0).gap(3).p(3).rounded(8).bg(t.raised || t.surface)
    .children(options.map(option => button(`${id}-${option.value}`, option.label,
      cx => onSelect(option.value, cx), { selected: option.value === selected, disabled, compact: true, grow: true, align: 'center' })));
}

function settings(view) {
  const t = theme(), controller = view.controller, rows = controller.rows ?? [], catalog = view.sessionCatalog ?? [];
  const disabled = view.preview || view.busy;
  const body = v_flex().id('approvals-settings').flex_1().min_h(0).min_w(0).gap(20).overflow_y_scrollbar();
  body.child(h_flex().items_start().gap(12)
    .child(v_flex().flex_1().min_w(0).gap(4)
      .child(label('Auto-approve')).child(description('Allow supported requests after the delay.')))
    .child(button('approvals-auto', controller.enabled ? 'On' : 'Off', cx => view.toggle(cx),
      { selected: controller.enabled, disabled: view.preview, compact: true, align: 'center' })));
  body.child(separator());
  body.child(setting('Delay', 'Time to examine the command or cancel.',
    segmented('approvals-delay', [{ value: 3000, label: '3 sec' }, { value: 5000, label: '5 sec' }, { value: 10000, label: '10 sec' }],
      view.delayMs ?? 3000, (value, cx) => view.setDelay(value, cx), disabled)));
  body.child(setting('Agents', view.scope === 'selected'
    ? 'Only selected Codex agents in Herdr.'
    : 'All local Codex agents in Herdr, including new agents.',
    segmented('approvals-scope', [{ value: 'all', label: 'All agents' }, { value: 'selected', label: 'Selected agents' }],
      view.scope ?? 'all', (value, cx) => view.setScope(value, cx), disabled)));
  if (view.scope === 'selected') {
    const selected = view.selectedSessions ?? [];
    const list = v_flex().min_w(0).gap(4);
    if (!catalog.length) list.child(description('No local Codex agents. Start one in Herdr.'));
    const states = { working: 'Working', idle: 'Idle', done: 'Done', blocked: 'Needs input', error: 'Error' };
    for (const row of catalog) {
      const included = selected.includes(row.sessionKey);
      list.child(button(`approvals-session-${row.address}`, h_flex().w_full().min_w(0).gap(8)
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().whitespace_normal().child(row.title || row.address))
          .child(description(states[row.status] || 'Unknown')))
        .child(div().flex_none().text_size(12).text_color(t.muted).child(included ? 'Included' : 'Select')),
      cx => view.toggleSession(row.sessionKey, cx), { selected: included, disabled, compact: true }));
    }
    if (selected.length) list.child(button('approvals-clear-agents', 'Clear selection', cx => view.clearSessions(cx), { disabled, compact: true }));
    list.child(description('Other requests remain available for manual replies.'));
    body.child(list);
  }
  body.child(setting('Automatic reply', view.mode === 'remember'
    ? 'Save a narrow command rule. If none exists, allow once. Ambiguous rules require a manual reply.'
    : 'Allow the current command once. Do not save a rule.',
  segmented('approvals-mode', [{ value: 'once', label: 'Allow once' }, { value: 'remember', label: 'Save command rule' }],
    view.mode, (value, cx) => view.setMode(value, cx), disabled)));
  body.child(separator());
  const connectionDisabled = disabled || rows.length > 0;
  body.child(setting('Connection', view.connection === 'cockpit'
    ? 'Use the existing local Cockpit installation.'
    : 'Connect directly to Herdr. Cockpit is optional.',
  segmented('approvals-provider', [{ value: 'native', label: 'Herdr' }, { value: 'cockpit', label: 'Cockpit' }],
    view.connection, (value, cx) => { if (value !== view.connection) view.switchProvider(cx); }, connectionDisabled)));
  if (rows.length) body.child(description('Resolve pending requests before you change the connection.'));
  if (view.error || controller.error) body.child(description(String(view.error || controller.error)));
  return body;
}

function countdown(view) {
  const t = theme(), pending = view.controller.pending;
  if (!pending) return null;
  const target = (view.controller.rows ?? []).find(row => row.sessionKey === pending.sessionKey);
  const seconds = Math.max(0, Math.ceil((pending.deadline - Date.now()) / 1000));
  return h_flex().min_w(0).items_start().gap(8).p(10).rounded(8).bg(t.raised || t.surface)
    .child(v_flex().flex_1().min_w(0).gap(3)
      .child(div().font_medium().whitespace_normal().child(`Auto-reply starts in ${seconds} sec`))
      .child(description(target?.title || target?.address || 'Pending request')))
    .child(button('approvals-cancel', 'Cancel · Esc', cx => view.cancel(cx), { compact: true }));
}

function requests(view, row) {
  const t = theme(), controller = view.controller, rows = controller.rows ?? [];
  const body = v_flex().id('approvals-requests').flex_1().min_h(0).min_w(0).gap(16).overflow_y_scrollbar();
  if (rows.length > 1) {
    const queue = v_flex().min_w(0).gap(3).child(description('Agents with requests'));
    for (const item of rows) queue.child(button(`approvals-row-${item.address}`, item.title || item.address,
      cx => view.pick(item, cx), { selected: item.sessionKey === row?.sessionKey, compact: true }));
    body.child(queue).child(separator());
  }
  if (!row) {
    return body.child(v_flex().flex_1().min_h(0).justify_center().gap(8).py(24)
      .child(div().text_size(15).font_medium().child('No pending requests'))
      .child(description('Codex permission requests appear here.'))
      .child(button('approvals-empty-settings', 'Open settings', cx => view.setTab('settings', cx), { compact: true })));
  }
  body.child(v_flex().min_w(0).gap(5)
    .child(div().text_size(15).font_semibold().whitespace_normal().child(row.title || row.address))
    .child(description(row.question.text)));
  body.child(div().p(12).rounded(8).bg(t.raised || t.surface).font_family('monospace').text_size(12).whitespace_normal().child(row.question.command));
  const choices = v_flex().min_w(0).gap(4).child(description('Select a reply'));
  for (const choice of row.question.choices) {
    const selected = view.choice === choice.n;
    const content = h_flex().w_full().min_w(0).items_start().gap(10)
      .child(div().flex_none().w(20).text_color(selected ? t.foreground : t.muted).child(String(choice.n)))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(div().whitespace_normal().child(choice.label))
        .when(Boolean(choice.description), el => el.child(description(choice.description))))
      .when(selected, el => el.child(div().flex_none().text_size(11).text_color(t.muted).child('Selected')));
    choices.child(button(`approvals-choice-${choice.n}`, content, cx => view.choose(row, choice.n, cx),
      { selected, disabled: view.busy || view.preview || row.quarantined }));
  }
  return body.child(choices);
}

function notice(view) {
  const controller = view.controller;
  if (view.error || controller.error) return description(String(view.error || controller.error));
  const texts = {
    validating: 'The panel reads the latest request.',
    dispatching: 'Reply in progress. Cancellation is no longer possible.',
    sending: 'Reply in progress. Cancellation is no longer possible.',
    sent: 'The panel sent your reply.',
    unknown: 'Delivery is uncertain. The panel will not send this reply again.',
    cancelled: view.choice !== null ? 'Your selection stopped automatic approval for this request.' : 'Automatic approval stopped for this request.',
    changed: 'The request changed. The panel stopped the reply.',
  };
  return texts[controller.status] ? description(texts[controller.status]) : null;
}

function compactPanel(view) {
  const t = theme(), controller = view.controller, rows = controller.rows ?? [], pending = controller.pending;
  const row = rows.find(item => item.sessionKey === pending?.sessionKey)
    ?? rows.find(item => item.sessionKey === view.selectedKey) ?? rows[0];
  const root = v_flex().id('approvals-compact').size_full().min_h(0).min_w(0).p(8).gap(6)
    .bg(t.background).text_color(t.foreground).text_size(12)
    .track_focus(view.focus).on_key_down((event, cx) => { if (view.key(event, cx)) cx.stop_propagation(); });
  root.child(h_flex().min_w(0).items_center().gap(4)
    .child(div().flex_1().min_w(0).font_semibold().text_size(14).child('Approvals'))
    .child(button('approvals-compact-auto', controller.enabled ? 'On' : 'Off', cx => view.toggle(cx),
      { selected: controller.enabled, disabled: view.preview, compact: true, align: 'center' }))
    .child(button('approvals-compact-settings', 'Settings', cx => view.setTab('settings', cx), { compact: true, align: 'center' })));
  if (view.preview) root.child(description('Preview · No input'));
  if (pending) {
    const seconds = Math.max(0, Math.ceil((pending.deadline - Date.now()) / 1000));
    root.child(v_flex().min_w(0).gap(3)
      .child(div().font_medium().child(`Starts in ${seconds} sec`))
      .child(div().min_w(0).truncate().text_color(t.muted).child(row?.title || row?.address || 'Pending request')));
    root.child(h_flex().min_w(0).gap(4)
      .child(button('approvals-compact-cancel', 'Cancel', cx => view.cancel(cx), { compact: true, grow: true, align: 'center', disabled: view.preview }))
      .child(button('approvals-compact-review', 'Review', cx => view.review(row, cx), { compact: true, grow: true, align: 'center', disabled: view.preview || !row })));
  } else if (row) {
    const state = view.busy || controller.busy ? 'Reply in progress'
      : row.quarantined ? 'Delivery uncertain'
      : `${rows.length} ${rows.length === 1 ? 'request' : 'requests'} waiting`;
    root.child(h_flex().min_w(0).items_center().gap(6)
      .child(div().flex_1().min_w(0).text_color(t.muted).child(state))
      .child(button('approvals-compact-review', 'Review', cx => view.review(row, cx), { compact: true, disabled: view.preview || view.busy || controller.busy })));
  } else {
    root.child(description(view.error || controller.error ? 'Connection needs attention. Open Settings.' : 'Waiting for requests.'));
    root.child(description(`${(view.delayMs ?? 3000) / 1000} sec · ${view.scope === 'selected' ? 'Selected agents' : 'All agents'}`));
  }
  return root;
}

export function panel(view, cx) {
  if (view.compact && !view.expanded) return compactPanel(view);
  const t = theme(), controller = view.controller, rows = controller.rows ?? [];
  const row = rows.find(item => item.sessionKey === view.selectedKey) ?? rows[0];
  const activeTab = view.tab === 'settings' ? 'settings' : 'requests';
  const root = v_flex().id('approvals-panel').size_full().min_h(0).min_w(0).p(16).gap(14)
    .bg(t.background).text_color(t.foreground).text_size(13)
    .track_focus(view.focus).on_key_down((event, cx) => { if (view.key(event, cx)) cx.stop_propagation(); });
  if (view.compact) root.child(h_flex().justify_end()
    .child(button('approvals-collapse', 'Collapse', cx => view.collapse(cx), { compact: true })));
  root.child(h_flex().min_w(0).items_start().gap(10)
    .child(v_flex().flex_1().min_w(0).gap(3)
      .child(div().text_size(19).font_semibold().child('Approvals'))
      .child(description('Codex permission requests')))
    .child(div().flex_none().px(8).py(4).rounded(6).bg(t.raised || t.surface).text_size(12).text_color(t.muted).child(`${rows.length} pending`)));
  root.child(h_flex().gap(4).min_w(0)
    .child(button('approvals-tab-requests', 'Requests', cx => view.setTab('requests', cx), { selected: activeTab === 'requests', compact: true, grow: true, align: 'center' }))
    .child(button('approvals-tab-settings', 'Settings', cx => view.setTab('settings', cx), { selected: activeTab === 'settings', compact: true, grow: true, align: 'center' })));
  root.child(separator());
  if (view.preview) root.child(description('Preview · No input'));
  if (activeTab === 'settings') return root.child(settings(view));
  const timer = countdown(view), status = notice(view);
  if (timer) root.child(timer);
  if (status) root.child(status);
  if (row?.quarantined) root.child(description('Reply in the agent terminal.'));
  root.child(requests(view, row));
  if (row) {
    root.child(separator()).child(h_flex().min_w(0).gap(8)
      .child(button('approvals-submit', 'Send reply', cx => view.submit(row, cx),
        { variant: 'primary', grow: true, align: 'center', disabled: view.choice === null || view.busy || view.preview || row.quarantined }))
      .child(button('approvals-focus', 'Open agent', cx => view.inspect(row, cx), { variant: 'secondary', align: 'center', disabled: view.preview })));
    root.child(description('1–9 select · Enter sends · Esc cancels auto-approve'));
  }
  return root;
}
