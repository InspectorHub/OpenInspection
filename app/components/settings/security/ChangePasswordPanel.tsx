import { Form } from "react-router";
import type { FormMetadata } from "@conform-to/react";
import type { ChangePasswordInput } from "~/lib/forms/settings.schema";
import { m } from "~/paraglide/messages";

interface ChangePasswordPanelProps {
  pwForm: FormMetadata<ChangePasswordInput, string[]>;
  pwFields: ReturnType<FormMetadata<ChangePasswordInput, string[]>["getFieldset"]>;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
}

export function ChangePasswordPanel({ pwForm, pwFields, showPassword, setShowPassword }: ChangePasswordPanelProps) {
  return (
    <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
      <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_pw_heading()}</h3>
      <Form
        method="post"
        id={pwForm.id}
        onSubmit={pwForm.onSubmit}
        noValidate
        className="space-y-4 max-w-md"
      >
        <input type="hidden" name="intent" value="change-password" />
        <div className="space-y-2">
          <label htmlFor={pwFields.currentPassword.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_pw_current_label()}</label>
          <input type={showPassword ? "text" : "password"} id={pwFields.currentPassword.id} name={pwFields.currentPassword.name} autoComplete="current-password"
            aria-invalid={pwFields.currentPassword.errors ? true : undefined}
            className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[13px] text-ih-fg-1" />
          {pwFields.currentPassword.errors && (
            <p className="mt-1 text-xs text-ih-bad-fg">{pwFields.currentPassword.errors[0]}</p>
          )}
        </div>
        <div className="space-y-2">
          <label htmlFor={pwFields.newPassword.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_pw_new_label()}</label>
          <input type={showPassword ? "text" : "password"} id={pwFields.newPassword.id} name={pwFields.newPassword.name} autoComplete="new-password"
            aria-invalid={pwFields.newPassword.errors ? true : undefined}
            className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[13px] text-ih-fg-1" />
          {pwFields.newPassword.errors && (
            <p className="mt-1 text-xs text-ih-bad-fg">{pwFields.newPassword.errors[0]}</p>
          )}
        </div>
        <div className="space-y-2">
          <label htmlFor={pwFields.confirmPassword.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_pw_confirm_label()}</label>
          <input type={showPassword ? "text" : "password"} id={pwFields.confirmPassword.id} name={pwFields.confirmPassword.name} autoComplete="new-password"
            aria-invalid={pwFields.confirmPassword.errors ? true : undefined}
            className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[13px] text-ih-fg-1" />
          {pwFields.confirmPassword.errors && (
            <p className="mt-1 text-xs text-ih-bad-fg">{pwFields.confirmPassword.errors[0]}</p>
          )}
        </div>
        {pwForm.errors && (
          <div className="px-3 py-2 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg">
            {pwForm.errors[0]}
          </div>
        )}
        <label className="flex items-center gap-2 text-[11px] text-ih-fg-3 cursor-pointer">
          <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)}
            className="rounded border-ih-border" />
          {m.settings_pw_show()}
        </label>
        <div className="flex justify-end pt-2 border-t border-ih-border">
          <button type="submit"
            className="px-4 py-2 bg-ih-primary text-white rounded-md font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all">
            {m.settings_pw_submit()}
          </button>
        </div>
      </Form>
    </section>
  );
}
