function AppleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.05 12.53c-.02-2.03 1.66-3 1.73-3.05-.94-1.38-2.4-1.57-2.92-1.59-1.24-.13-2.42.73-3.05.73-.63 0-1.6-.71-2.63-.69-1.35.02-2.6.79-3.3 2-.14.25-1.6 2.82.55 5.51.7.88 1.53 1.87 2.62 1.83 1.05-.04 1.45-.68 2.72-.68 1.27 0 1.63.68 2.74.66 1.13-.02 1.85-.9 2.54-1.79.8-1.02 1.13-2.01 1.15-2.06-.03-.01-2.2-.85-2.22-3.37zM15.1 6.31c.57-.69.96-1.65.85-2.61-.82.03-1.82.55-2.41 1.24-.53.61-.99 1.59-.87 2.53.92.07 1.86-.47 2.43-1.16z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <path d="M3.6 2.4c-.25.26-.4.66-.4 1.18v16.84c0 .52.15.92.4 1.18l.06.06L13 12.06v-.12L3.66 2.34l-.06.06z" fill="#34d399" />
      <path d="M16.3 15.35L13 12.06v-.12l3.3-3.29.08.04 3.92 2.23c1.12.63 1.12 1.67 0 2.31l-3.92 2.23-.08.05z" fill="#10b981" />
      <path d="M16.38 15.3L13 12 3.6 21.4c.37.39.98.44 1.67.05l11.11-6.15z" fill="#059669" />
      <path d="M16.38 8.7L5.27 2.55c-.69-.39-1.3-.34-1.67.05L13 12l3.38-3.3z" fill="#6ee7b7" />
    </svg>
  );
}

function StoreButton({
  href,
  small,
  big,
  icon,
}: {
  href: string;
  small: string;
  big: string;
  icon: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="glass-strong flex items-center gap-3 rounded-2xl px-4 py-2.5 text-white transition-transform hover:scale-[1.02]"
    >
      <span className="text-white">{icon}</span>
      <span className="flex flex-col leading-tight">
        <span className="text-[10px] text-white/70">{small}</span>
        <span className="text-sm font-semibold">{big}</span>
      </span>
    </a>
  );
}

export function StoreButtons() {
  return (
    <div className="flex flex-wrap gap-3">
      <StoreButton
        href="https://apps.apple.com/app/reidey"
        small="Laden im"
        big="App Store"
        icon={<AppleIcon />}
      />
      <StoreButton
        href="https://play.google.com/store/apps/details?id=de.reidey.app"
        small="Jetzt bei"
        big="Google Play"
        icon={<PlayIcon />}
      />
    </div>
  );
}
