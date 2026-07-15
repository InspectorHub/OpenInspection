/**
 * Official Google OAuth button (brand guidelines).
 *
 * https://developers.google.com/identity/branding-guidelines
 *
 * ds-allow: Google's exact brand palette is required — steps outside ihp-* tokens.
 */
interface GoogleSignInButtonProps {
  href?: string;
  onClick?: () => void;
  label?: string;
  disabled?: boolean;
}

function GoogleGMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.103-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.346l2.582-2.581C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

export function GoogleSignInButton({
  href,
  onClick,
  label = "Continue with Google",
  disabled = false,
}: GoogleSignInButtonProps) {
  // ds-allow: official Google button palette per branding guidelines
  const buttonClass =
    "flex w-full items-center justify-center gap-3 h-[46px] rounded-lg border border-[#747775] bg-white px-4 text-[15px] font-medium text-[#1f1f1f] transition-colors hover:bg-[#f7f8fa] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4285f4] disabled:opacity-60 disabled:pointer-events-none disabled:cursor-not-allowed";

  const style = { fontFamily: "'Roboto', system-ui, -apple-system, 'Segoe UI', sans-serif" };

  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={buttonClass}
        style={style}
      >
        <GoogleGMark />
        <span>{label}</span>
      </span>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={buttonClass}
        style={style}
      >
        <GoogleGMark />
        <span>{label}</span>
      </button>
    );
  }

  if (!href) {
    return (
      <span aria-disabled="true" className={buttonClass} style={style}>
        <GoogleGMark />
        <span>{label}</span>
      </span>
    );
  }

  return (
    <a
      href={href}
      className={buttonClass}
      style={style}
    >
      <GoogleGMark />
      <span>{label}</span>
    </a>
  );
}
