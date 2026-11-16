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
  const t = theme(), controller = view.controller, rows = controller.rows ?? [];
  const disabled = view.preview || view.busy;
  const body = v_flex().id('approvals-settings').flex_1().min_h(0).min_w(0).gap(20).overflow_y_scrollbar();
  body.child(v_flex().gap(4)
    .child(div().text_size(14).font_semibold().child('자동화'))
    .child(description('승인할 대상과 기다리는 시간을 설정합니다.')));
  body.child(h_flex().items_start().gap(12)
    .child(v_flex().flex_1().min_w(0).gap(4)
      .child(label('자동 승인')).child(description('대상 세션의 요청을 대기 후 전송합니다.')))
    .child(button('approvals-auto', controller.enabled ? '켜짐' : '꺼짐', cx => view.toggle(cx),
      { selected: controller.enabled, disabled: view.preview, compact: true, align: 'center' })));
  body.child(setting('대기 시간', '요청을 확인하거나 취소할 시간입니다.',
    segmented('approvals-delay', [{ value: 3000, label: '3초' }, { value: 5000, label: '5초' }, { value: 10000, label: '10초' }],
      view.delayMs ?? 3000, (value, cx) => view.setDelay(value, cx), disabled)));
  body.child(setting('대상', '이 기기의 Codex 세션에만 적용됩니다.',
    segmented('approvals-scope', [{ value: 'all', label: '전체 Codex' }, { value: 'selected', label: '선택한 세션' }],
      view.scope ?? 'all', (value, cx) => view.setScope(value, cx), disabled)));
  if (view.scope === 'selected') {
    const selected = view.selectedSessions ?? [];
    const list = v_flex().min_w(0).gap(4);
    if (!rows.length) list.child(description('대기 중인 요청이 생기면 여기서 세션을 선택할 수 있습니다.'));
    for (const row of rows) {
      const included = selected.includes(row.sessionKey);
      list.child(button(`approvals-session-${row.address}`, h_flex().w_full().min_w(0).gap(8)
        .child(div().flex_1().min_w(0).whitespace_normal().child(row.title || row.address))
        .child(div().flex_none().text_size(12).text_color(t.muted).child(included ? '포함됨' : '선택')),
      cx => view.toggleSession(row.sessionKey, cx), { selected: included, disabled, compact: true }));
    }
    list.child(description('선택한 세션에만 자동 승인을 적용합니다. 수동 응답은 모든 요청에서 가능합니다.'));
    body.child(list);
  }
  body.child(setting('승인 방식', view.mode === 'remember'
    ? '지원하는 동일 범위 선택지가 있을 때 권한을 기억합니다.'
    : '각 요청에 한 번만 허용합니다.',
  segmented('approvals-mode', [{ value: 'once', label: '이번만' }, { value: 'remember', label: '동일 범위 기억' }],
    view.mode, (value, cx) => view.setMode(value, cx), disabled)));
  body.child(separator());
  body.child(v_flex().gap(4).child(div().text_size(14).font_semibold().child('연결'))
    .child(description('승인 요청을 가져올 연결을 선택합니다.')));
  const connectionDisabled = disabled || rows.length > 0;
  body.child(setting('연결 방식', view.connection === 'cockpit'
    ? '실행 중인 로컬 Cockpit을 사용합니다.'
    : 'Cockpit 없이 Herdr에 직접 연결합니다.',
  segmented('approvals-provider', [{ value: 'native', label: 'Herdr 직접' }, { value: 'cockpit', label: 'Cockpit' }],
    view.connection, (value, cx) => { if (value !== view.connection) view.switchProvider(cx); }, connectionDisabled)));
  if (rows.length) body.child(description('대기 중인 요청을 정리한 뒤 연결을 바꿀 수 있습니다.'));
  if (view.error || controller.error) body.child(description(String(view.error || controller.error)));
  body.child(description('전송이 시작된 요청은 취소할 수 없으며, 실제 입력 전달이 늦어질 수 있습니다.'));
  return body;
}

function countdown(view) {
  const t = theme(), pending = view.controller.pending;
  if (!pending) return null;
  const target = (view.controller.rows ?? []).find(row => row.sessionKey === pending.sessionKey);
  const seconds = Math.max(0, Math.ceil((pending.deadline - Date.now()) / 1000));
  return h_flex().min_w(0).items_start().gap(8).p(10).rounded(8).bg(t.raised || t.surface)
    .child(v_flex().flex_1().min_w(0).gap(3)
      .child(div().font_medium().whitespace_normal().child(`${seconds}초 뒤 자동 승인 전송`))
      .child(description(target?.title || target?.address || '대기 중인 요청')))
    .child(button('approvals-cancel', '취소 · Esc', cx => view.cancel(cx), { compact: true }));
}

function requests(view, row) {
  const t = theme(), controller = view.controller, rows = controller.rows ?? [];
  const body = v_flex().id('approvals-requests').flex_1().min_h(0).min_w(0).gap(16).overflow_y_scrollbar();
  if (rows.length > 1) {
    const queue = v_flex().min_w(0).gap(3).child(description('대기 중인 세션'));
    for (const item of rows) queue.child(button(`approvals-row-${item.address}`, item.title || item.address,
      cx => view.pick(item, cx), { selected: item.sessionKey === row?.sessionKey, compact: true }));
    body.child(queue).child(separator());
  }
  if (!row) {
    return body.child(v_flex().flex_1().min_h(0).justify_center().gap(8).py(24)
      .child(div().text_size(15).font_medium().child('기다리는 승인이 없습니다'))
      .child(description('로컬 Codex가 실행 승인을 요청하면 여기에 표시됩니다.'))
      .child(button('approvals-empty-settings', '자동 승인 설정 보기', cx => view.setTab('settings', cx), { compact: true })));
  }
  body.child(v_flex().min_w(0).gap(5)
    .child(div().text_size(15).font_semibold().whitespace_normal().child(row.title || row.address))
    .child(description(row.question.text)));
  body.child(div().p(12).rounded(8).bg(t.raised || t.surface).font_family('monospace').text_size(12).whitespace_normal().child(row.question.command));
  const choices = v_flex().min_w(0).gap(4).child(description('답변 선택'));
  for (const choice of row.question.choices) {
    const selected = view.choice === choice.n;
    const content = h_flex().w_full().min_w(0).items_start().gap(10)
      .child(div().flex_none().w(20).text_color(selected ? t.foreground : t.muted).child(String(choice.n)))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(div().whitespace_normal().child(choice.label))
        .when(Boolean(choice.description), el => el.child(description(choice.description))))
      .when(selected, el => el.child(div().flex_none().text_size(11).text_color(t.muted).child('선택됨')));
    choices.child(button(`approvals-choice-${choice.n}`, content, cx => view.choose(row, choice.n, cx),
      { selected, disabled: view.busy || view.preview || row.quarantined }));
  }
  return body.child(choices);
}

function notice(view) {
  const controller = view.controller;
  if (view.error || controller.error) return description(String(view.error || controller.error));
  const texts = {
    validating: '승인 요청을 다시 확인하고 있습니다.',
    dispatching: '전송 중 · 이 요청은 취소할 수 없습니다.',
    sending: '전송 중 · 이 요청은 취소할 수 없습니다.',
    sent: '선택한 답변을 전송했습니다.',
    unknown: '전송 여부를 확인해야 합니다. 자동으로 다시 보내지 않습니다.',
    cancelled: view.choice !== null ? '직접 선택 중 · 이 요청의 자동 승인을 멈췄습니다.' : '이 요청의 자동 승인을 취소했습니다.',
    changed: '요청이 바뀌어 전송을 멈췄습니다.',
  };
  return texts[controller.status] ? description(texts[controller.status]) : null;
}

export function panel(view, cx) {
  const t = theme(), controller = view.controller, rows = controller.rows ?? [];
  const row = rows.find(item => item.sessionKey === view.selectedKey) ?? rows[0];
  const activeTab = view.tab === 'settings' ? 'settings' : 'requests';
  const root = v_flex().id('approvals-panel').size_full().min_h(0).min_w(0).p(16).gap(14)
    .bg(t.background).text_color(t.foreground).text_size(13)
    .track_focus(view.focus).on_key_down((event, cx) => { if (view.key(event, cx)) cx.stop_propagation(); });
  root.child(h_flex().min_w(0).items_start().gap(10)
    .child(v_flex().flex_1().min_w(0).gap(3)
      .child(div().text_size(19).font_semibold().child('Approvals'))
      .child(description('로컬 Codex 승인')))
    .child(div().flex_none().px(8).py(4).rounded(6).bg(t.raised || t.surface).text_size(12).text_color(t.muted).child(`${rows.length}개 대기`)));
  root.child(h_flex().gap(4).min_w(0)
    .child(button('approvals-tab-requests', '요청', cx => view.setTab('requests', cx), { selected: activeTab === 'requests', compact: true, grow: true, align: 'center' }))
    .child(button('approvals-tab-settings', '설정', cx => view.setTab('settings', cx), { selected: activeTab === 'settings', compact: true, grow: true, align: 'center' })));
  root.child(separator());
  if (view.preview) root.child(description('미리보기 · 실제 입력을 보내지 않습니다'));
  if (activeTab === 'settings') return root.child(settings(view));
  const timer = countdown(view), status = notice(view);
  if (timer) root.child(timer);
  if (status) root.child(status);
  if (row?.quarantined) root.child(description('이 세션의 이전 전송을 확인해야 합니다. 세션을 열어 직접 답해 주세요.'));
  root.child(requests(view, row));
  if (row) {
    const selectedChoice = row.question.choices.find(choice => choice.n === view.choice);
    const denied = /^No\b/i.test(selectedChoice?.label || '');
    root.child(separator()).child(h_flex().min_w(0).gap(8)
      .child(button('approvals-submit', denied ? '선택 거부' : '선택 승인', cx => view.submit(row, cx),
        { variant: 'primary', grow: true, align: 'center', disabled: view.choice === null || view.busy || view.preview || row.quarantined }))
      .child(button('approvals-focus', '세션 열기', cx => view.inspect(row, cx), { variant: 'secondary', align: 'center', disabled: view.preview })));
    root.child(description('숫자로 선택 · Enter로 전송 · Esc로 자동 승인 취소'));
  }
  return root;
}
