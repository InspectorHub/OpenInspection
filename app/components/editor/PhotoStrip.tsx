import { useState } from "react";

interface Photo {
  id: string;
  url: string;
  caption?: string;
}

interface PhotoStripProps {
  photos: Photo[];
  onAdd?: () => void;
  onRemove?: (id: string) => void;
  onExpand?: (photo: Photo) => void;
}

export function PhotoStrip({ photos, onAdd, onRemove, onExpand }: PhotoStripProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const expanded = expandedId ? photos.find((p) => p.id === expandedId) : null;

  function handleExpand(photo: Photo) {
    setExpandedId(photo.id);
    onExpand?.(photo);
  }

  return (
    <div className="space-y-2" data-testid="photo-strip">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {photos.map((photo) => (
          <div key={photo.id} className="relative flex-shrink-0 group">
            <button
              type="button"
              onClick={() => handleExpand(photo)}
              className="block w-16 h-16 rounded-md overflow-hidden border-2 border-ih-border hover:border-ih-primary transition-colors"
            >
              <img src={photo.url} alt={photo.caption || "Photo"} className="w-full h-full object-cover" />
            </button>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(photo.id)}
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-ih-bad text-white text-xs font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-ih-bad/85"
                aria-label="Remove photo"
              >
                x
              </button>
            )}
          </div>
        ))}

        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="flex-shrink-0 w-16 h-16 rounded-md border-2 border-dashed border-ih-border-strong flex items-center justify-center text-ih-fg-4 hover:border-ih-primary hover:text-ih-primary transition-colors"
            aria-label="Add photo"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </div>

      {photos.length === 0 && (
        <p className="text-xs text-ih-fg-4">No photos yet.</p>
      )}

      {/* Expanded view */}
      {expanded && (
        <div className="fixed inset-0 z-50 bg-[rgba(0,0,0,0.8)] flex items-center justify-center p-4" onClick={() => setExpandedId(null)}>
          <div className="relative max-w-3xl max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <img src={expanded.url} alt={expanded.caption || "Photo"} className="max-w-full max-h-[80vh] rounded-lg object-contain" />
            {/* ds-allow: fixed-dark photo lightbox overlay (light-on-dark over image) */}
            <button
              type="button"
              onClick={() => setExpandedId(null)}
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {/* ds-allow: fixed-dark photo lightbox caption (light-on-dark over image) */}
            {expanded.caption && (
              <p className="mt-2 text-center text-sm text-white/80">{expanded.caption}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
