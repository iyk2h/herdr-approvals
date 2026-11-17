import { div } from 'gpui-kit';
import { Button, Input, v_flex, h_flex } from 'gpui-base';
import { settings as herdrSettings, theme } from 'herdr';

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

function autoToggle(id, view) {
  const t = theme(), enabled = view.controller.enabled;
  const track = h_flex().w(26).h(16).p(2).rounded(8).items_center().flex_none()
    .bg(enabled ? t.accent : t.border)
    .when(enabled, el => el.justify_end())
    .when(!enabled, el => el.justify_start())
    .child(div().w(12).h(12).rounded(6).bg(enabled ? t.accent_foreground : t.muted));
  const state = h_flex().gap(5).items_center()
    .child(div().text_size(11).font_semibold().text_color(enabled ? t.foreground : t.muted)
      .child(enabled ? 'ON' : 'OFF'))
    .child(track);
  return button(id, state, cx => view.toggle(cx),
    { disabled: view.preview, compact: true, align: 'center' }).w(68).flex_none().px(4).py(3);
}

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
    .child(autoToggle('approvals-auto', view)));
  body.child(separator());
  const delay = v_flex().min_w(0).gap(8)
    .child(segmented('approvals-delay', [{ value: 3000, label: '3 sec' }, { value: 5000, label: '5 sec' }, { value: 10000, label: '10 sec' }],
      view.delayMs ?? 3000, (value, cx) => { view.delayInput?.set_value(String(value / 1000)); view.setDelay(value, cx); }, disabled));
  if (view.delayInput) delay.child(h_flex().min_w(0).items_center().gap(8)
    .child(Input.new(view.delayInput).id('approvals-custom-delay').w(96).h(32).px(8).rounded(6)
      .border(1).border_color(t.input || t.border).bg(t.raised || t.surface).text_color(t.foreground).text_size(13).disabled(disabled))
    .child(description('sec'))
    .child(button('approvals-apply-delay', 'Apply', cx => view.applyDelayInput(cx), { compact: true, disabled, variant: 'secondary' })));
  delay.child(description(view.delayError || '1–3,600 sec. Press Enter or select Apply.'));
  body.child(setting('Delay', 'Time to examine the command or cancel.', delay));
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
    ? 'Use an offered command rule. If no supported rule exists, allow once. Multiple rules require a manual reply.'
    : 'Allow this request once. Do not save a rule.',
  segmented('approvals-mode', [{ value: 'once', label: 'Allow once' }, { value: 'remember', label: 'Save command rule' }],
    view.mode, (value, cx) => view.setMode(value, cx), disabled)));
  body.child(separator());
  const connectionDisabled = disabled || rows.length > 0;
  body.child(setting('Connection', view.connection === 'cockpit'
    ? 'Use the existing local Cockpit installation.'
    : 'Connect directly to Herdr. Cockpit is optional.',
  segmented('approvals-provider', [{ value: 'native', label: 'Herdr' }, { value: 'cockpit', label: 'Cockpit' }],
    view.connection, (value, cx) => { if (value !== view.connection) view.switchProvider(cx, value); }, connectionDisabled)));
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
    .child(button('approvals-cancel', view.presentation ? 'Cancel' : 'Cancel · Esc', cx => view.cancel(cx), { compact: true }));
}

function requests(view, row) {
  const t = theme(), controller = view.controller, rows = controller.rows ?? [];
  const compactEmpty = view.presentation && !row;
  const body = v_flex().id('approvals-requests').min_h(0).min_w(0).gap(16)
    .when(compactEmpty, el => el.flex_none())
    .when(!compactEmpty, el => el.flex_1().overflow_y_scrollbar());
  if (rows.length > 1) {
    const queue = v_flex().min_w(0).gap(3).child(description('Agents with requests'));
    for (const item of rows) queue.child(button(`approvals-row-${item.address}`, item.title || item.address,
      cx => view.pick(item, cx), { selected: item.sessionKey === row?.sessionKey, compact: true }));
    body.child(queue).child(separator());
  }
  if (!row) {
    return body.child(v_flex().min_h(0).gap(8).py(24)
      .when(compactEmpty, el => el.flex_none())
      .when(!compactEmpty, el => el.flex_1().justify_center())
      .child(div().text_size(15).font_medium().child('No pending requests'))
      .child(description('Codex permission requests appear here.')));
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

function notice(view, row) {
  const controller = view.controller;
  if (view.error || controller.error) return description(String(view.error || controller.error));
  const request = controller.statusRequest;
  const matches = row && request && row.sessionKey === request.sessionKey && row.episode === request.episode
    && row.question.fingerprint === request.fingerprint;
  if (['validating', 'dispatching', 'sending', 'sent', 'changed'].includes(controller.status) && !matches) return null;
  if (controller.status === 'unknown' && !row?.quarantined && !matches) return null;
  const texts = {
    validating: 'The panel reads the latest request.',
    dispatching: 'Reply in progress. Cancellation is no longer possible.',
    sending: 'Reply in progress. Cancellation is no longer possible.',
    sent: 'The panel sent your reply.',
    unknown: 'Delivery is uncertain.',
    cancelled: controller.pending ? 'Other requests continue to count down.' : 'Automatic approval stopped.',
    changed: 'The request changed. The panel stopped the reply.',
  };
  return texts[controller.status] ? description(texts[controller.status]) : null;
}

function compactPanel(view) {
  const t = theme(), controller = view.controller, rows = controller.rows ?? [], pending = controller.pending;
  const row = rows.find(item => item.sessionKey === pending?.sessionKey)
    ?? rows.find(item => item.sessionKey === view.selectedKey) ?? rows[0];
  const seconds = pending ? Math.max(0, Math.ceil((pending.deadline - Date.now()) / 1000)) : null;
  const status = view.busy || controller.busy ? 'Sending'
    : pending ? `${rows.length} · ${seconds}s`
    : view.error || controller.error ? 'Check' : `${rows.length} pending`;
  return h_flex().id('approvals-compact').w_full().h(40).min_h(40).max_h(40).min_w(0).px(8).gap(4).items_center()
    .bg(t.background).text_color(t.foreground).text_size(12)
    .track_focus(view.focus).on_key_down((event, cx) => { if (view.key(event, cx)) cx.stop_propagation(); })
    .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(13).child('Approval'))
    .child(autoToggle('approvals-compact-auto', view))
    .child(button('approvals-compact-requests', div().min_w(0).truncate().text_size(12).child(status), cx => row ? view.review(row, cx) : view.setTab('requests', cx),
      { compact: true, align: 'center', disabled: view.preview || view.busy || controller.busy }).w(78).flex_none().px(4).py(3))
    .child(button('approvals-compact-settings', div().whitespace_nowrap().child('Settings'), cx => view.setTab('settings', cx),
      { compact: true, align: 'center', disabled: view.preview }).w(64).flex_none().px(4).py(3));
}

function requestPanel(root, view, row) {
  const timer = countdown(view), status = notice(view, row);
  if (timer) root.child(timer);
  if (status) root.child(status);
  if (row?.quarantined) root.child(description('Reply in the agent terminal.'));
  root.child(requests(view, row));
  if (row) {
    root.child(separator()).child(h_flex().min_w(0).gap(8)
      .child(button('approvals-submit', 'Send reply', cx => view.submit(row, cx),
        { variant: 'primary', grow: true, align: 'center', disabled: view.choice === null || view.busy || view.preview || row.quarantined }))
      .child(button('approvals-focus', 'Open agent', cx => view.inspect(row, cx), { variant: 'secondary', align: 'center', disabled: view.preview })));
    root.child(description(view.presentation ? '1–9 select · Enter sends · Esc closes' : '1–9 select · Enter sends · Esc cancels auto-approve'));
  }
  return root;
}

function popupPanel(view) {
  const t = theme();
  const rows = view.controller?.rows ?? [];
  const row = rows.find(item => item.sessionKey === view.selectedKey) ?? rows[0];
  const preferredHeight = view.unavailable ? null : view.tab === 'settings' ? 720 : row ? 620 : null;
  const root = v_flex().id('approvals-popup').w_full().min_h(0).min_w(0).p(18).gap(14)
    .bg(t.background).text_color(t.foreground).text_size(13)
    .track_focus(view.focus).on_key_down((event, cx) => { if (view.key(event, cx)) cx.stop_propagation(); });
  if (preferredHeight) {
    const viewportHeight = globalThis.window?.viewport_size?.()?.height;
    const scale = herdrSettings().zoom;
    const zoom = typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1;
    root.h(preferredHeight);
    if (Number.isFinite(viewportHeight) && viewportHeight > 0) root.max_h(Math.max(1, viewportHeight / zoom * 0.85));
  }
  root.child(h_flex().min_w(0).items_center().gap(8)
    .child(div().flex_1().min_w(0).font_semibold().text_size(17).child(view.tab === 'settings' ? 'Approval settings' : 'Approval requests'))
    .child(button('approvals-popup-close', 'Close', () => view.dismiss(), { compact: true, align: 'center' })));
  root.child(separator());
  if (view.unavailable) return root.child(description('This panel is no longer available. Open Approval again.'));
  if (view.preview) root.child(description('Preview · No input'));
  if (view.tab === 'settings') return root.child(settings(view));
  return requestPanel(root, view, row);
}

export function panel(view, cx) {
  if (view.presentation) return popupPanel(view);
  if (view.compact) return compactPanel(view);
  const t = theme(), controller = view.controller, rows = controller.rows ?? [];
  const row = rows.find(item => item.sessionKey === view.selectedKey) ?? rows[0];
  const activeTab = view.tab === 'settings' ? 'settings' : 'requests';
  const root = v_flex().id('approvals-panel').size_full().min_h(0).min_w(0).p(16).gap(14)
    .bg(t.background).text_color(t.foreground).text_size(13)
    .track_focus(view.focus).on_key_down((event, cx) => { if (view.key(event, cx)) cx.stop_propagation(); });
  root.child(h_flex().min_w(0).items_start().gap(10)
    .child(v_flex().flex_1().min_w(0).gap(3)
      .child(div().text_size(19).font_semibold().child('Approval'))
      .child(description('Codex permission requests')))
    .child(div().flex_none().px(8).py(4).rounded(6).bg(t.raised || t.surface).text_size(12).text_color(t.muted).child(`${rows.length} pending`)));
  root.child(h_flex().gap(4).min_w(0)
    .child(button('approvals-tab-requests', 'Requests', cx => view.setTab('requests', cx), { selected: activeTab === 'requests', compact: true, grow: true, align: 'center' }))
    .child(button('approvals-tab-settings', 'Settings', cx => view.setTab('settings', cx), { selected: activeTab === 'settings', compact: true, grow: true, align: 'center' })));
  root.child(separator());
  if (view.preview) root.child(description('Preview · No input'));
  if (activeTab === 'settings') return root.child(settings(view));
  return requestPanel(root, view, row);
}
