import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../hooks/use-auth';
import { cn } from '../../lib/cn';
import { initials } from '../../lib/format';
import { Icon } from '../ui/Icon';

const MENU_ITEM = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm';

/**
 * Current user at the bottom of the sidebar. Opens a small menu (Profil saya, Keluar):
 * upwards when the sidebar is expanded, to the right of the avatar when collapsed.
 */
export function SidebarProfile({ collapsed }: { collapsed: boolean }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

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
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={collapsed ? user.name : undefined}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-slate-100',
          open && 'bg-slate-100',
          collapsed && 'justify-center',
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700">
          {initials(user.name)}
        </span>
        <span className={cn('min-w-0 flex-1', collapsed && 'sr-only')}>
          <span className="block truncate text-sm font-medium text-slate-900">{user.name}</span>
          <span className="block truncate text-xs text-slate-500">{user.role.name}</span>
        </span>
        <Icon
          name="chevronDown"
          className={cn('size-4 shrink-0 text-slate-400 transition-transform', !open && 'rotate-180', collapsed && 'hidden')}
        />
      </button>

      <div
        id={menuId}
        role="menu"
        hidden={!open}
        className={cn(
          'absolute z-50 rounded-xl border border-slate-200 bg-white p-1 shadow-lg',
          collapsed ? 'bottom-0 left-full ml-3 w-60' : 'right-0 bottom-full left-0 mb-2',
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
          className={cn(MENU_ITEM, 'mt-1 text-slate-700 hover:bg-slate-100')}
        >
          <Icon name="user" className="size-4" /> Profil saya
        </Link>
        <button
          role="menuitem"
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className={cn(MENU_ITEM, 'text-red-600 hover:bg-red-50 disabled:opacity-60')}
        >
          <Icon name="logout" className="size-4" /> {loggingOut ? 'Keluar…' : 'Keluar'}
        </button>
      </div>
    </div>
  );
}
