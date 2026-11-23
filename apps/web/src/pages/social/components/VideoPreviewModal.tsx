import type { QueueItemDto } from '@ai-preneur/shared';

import { Modal } from '../../../components/ui/Modal';
import { drivePreviewUrl, driveViewUrl } from '../../../lib/drive';

/** Plays a queue row's video with Google Drive's embedded player (portrait 9:16). */
export function VideoPreviewModal({ item, onClose }: { item: QueueItemDto | null; onClose: () => void }) {
  return (
    <Modal open={item !== null} onClose={onClose} title={item?.title ?? ''} description={item?.videoFileName}>
      {item && (
        <div className="space-y-3">
          <div className="mx-auto aspect-[9/16] max-h-[65dvh] overflow-hidden rounded-xl bg-slate-900">
            <iframe
              key={item.videoFileId}
              src={drivePreviewUrl(item.videoFileId)}
              title={`Pratinjau video ${item.title}`}
              allow="autoplay; encrypted-media; fullscreen"
              allowFullScreen
              className="h-full w-full border-0"
            />
          </div>
          <p className="text-center text-xs text-slate-500">
            Video tidak muncul?{' '}
            <a
              href={driveViewUrl(item.videoFileId)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary-700 underline underline-offset-2"
            >
              Buka di Google Drive
            </a>
          </p>
        </div>
      )}
    </Modal>
  );
}
