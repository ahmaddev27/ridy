function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7 text-white" aria-hidden>
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7 text-white" aria-hidden>
      <path d="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 01-.61-.92V2.734a1 1 0 01.609-.92zM14.439 11.293l3.6-2.08 2.6 1.5c.86.5.86 1.74 0 2.24l-2.6 1.5-3.6-2.08z" />
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
      className="glass-strong inline-flex items-center gap-3 rounded-2xl px-5 py-3 text-white transition-colors hover:border-white/20"
    >
      {icon}
      <span className="text-left leading-tight">
        <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
          {small}
        </span>
        <span className="font-heading block text-sm font-semibold text-white">
          {big}
        </span>
      </span>
    </a>
  );
}

export function StoreButtons() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 lg:justify-start">
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
