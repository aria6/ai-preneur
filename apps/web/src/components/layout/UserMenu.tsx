import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../hooks/use-auth';
import { cn } from '../../lib/cn';
import { initials } from '../../lib/format';
import { Icon } from '../ui/Icon';

export function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-slate-100"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700">
          {initials(user.name)}
        </span>
        <span className="hidden max-w-40 text-left sm:block">
          <span className="block truncate text-sm font-medium text-slate-900">{user.name}</span>
          <span className="block truncate text-xs text-slate-500">{user.role.name}</span>
        </span>
        <Icon name="chevronDown" className="hidden size-4 text-slate-400 sm:block" />
      </button>

      <div
        role="menu"
        className={cn(
          'absolute right-0 z-40 mt-2 w-60 origin-top-right rounded-xl border border-slate-200 bg-white p-1 shadow-lg',
          open ? 'block' : 'hidden',
        )}
      >
        <div className="border-b border-slate-100 px-3 py-2">
          <p className="truncate text-sm font-medium text-slate-900">{user.name}</p>
          <p className="truncate text-xs text-slate-500">{user.email}</p>
        </div>
        <Link
          role="menuitem"
          to="/profile"
          onClick={() => setOpen(false)}
          className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          <Icon name="user" className="size-4" /> Profil saya
        </Link>
        <button
          role="menuitem"
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
        >
          <Icon name="logout" className="size-4" /> {loggingOut ? 'Keluar…' : 'Keluar'}
        </button>
      </div>
    </div>
  );
}
