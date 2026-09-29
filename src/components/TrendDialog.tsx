'use client';

import { useRef, useState } from 'react';
import type { Polarity } from '@/lib/counter';
import { TrendChart } from './TrendChart';
import { TrendSparkline } from './TrendSparkline';

// The sparkline is the button; the full chart only mounts once opened, so its
// dates are computed in the browser's zone and never race server rendering.
export function TrendDialog({
  history,
  label,
  polarity,
}: {
  history: number[];
  label: string;
  polarity: Polarity;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  if (history.length < 2) return null;

  const open = () => {
    setOpenedAt(Date.now());
    dialog.current?.showModal();
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        aria-label={`Open the ${label} counter trend`}
        className="cursor-pointer rounded-sm opacity-90 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-ash"
      >
        <TrendSparkline history={history} />
      </button>

      <dialog
        ref={dialog}
        onClose={() => setOpenedAt(null)}
        // A click whose target is the dialog itself landed on the backdrop: the
        // inner div fills the whole box, so any click inside it targets that.
        onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
        className="m-auto w-[min(48rem,calc(100vw-2rem))] border border-hairline bg-panel p-0 text-bone backdrop:bg-void/80 backdrop:backdrop-blur-sm"
      >
        <div className="flex flex-col gap-4 p-5">
          <header className="flex items-center gap-4">
            <h2 className="text-xs tracking-[0.3em] text-ash">
              /// {label.toUpperCase()} <span className="text-hairline">/</span> LAST {history.length - 1} DAYS
            </h2>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="ml-auto cursor-pointer text-xs tracking-[0.3em] text-ash hover:text-bone"
            >
              CLOSE
            </button>
          </header>
          {openedAt !== null && <TrendChart history={history} endsAt={openedAt} polarity={polarity} />}
        </div>
      </dialog>
    </>
  );
}
