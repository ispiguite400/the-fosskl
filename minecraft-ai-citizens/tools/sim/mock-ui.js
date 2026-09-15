/** Mock of @minecraft/server-ui - records what a form would have shown. */
export const uiLog = [];

class Form {
  constructor(kind) { this.kind = kind; this.spec = { buttons: [], fields: [] }; }
  title(t) { this.spec.title = t; return this; }
  body(t) { this.spec.body = t; return this; }
  button(t, icon) { this.spec.buttons.push(t); return this; }
  button1(t) { this.spec.buttons.push(t); return this; }
  button2(t) { this.spec.buttons.push(t); return this; }
  slider(label, min, max, step, def) { this.spec.fields.push({ label, def }); return this; }
  dropdown(label, options, def) { this.spec.fields.push({ label, options, def }); return this; }
  textField(label, ph, def) { this.spec.fields.push({ label, def }); return this; }
  toggle(label, def) { this.spec.fields.push({ label, def }); return this; }
  async show() {
    uiLog.push({ kind: this.kind, ...this.spec });
    return { canceled: true, selection: undefined, formValues: [] };
  }
}

export class ActionFormData extends Form { constructor() { super("action"); } }
export class ModalFormData extends Form { constructor() { super("modal"); } }
export class MessageFormData extends Form { constructor() { super("message"); } }
export const FormCancelationReason = { UserBusy: "UserBusy", UserClosed: "UserClosed" };
