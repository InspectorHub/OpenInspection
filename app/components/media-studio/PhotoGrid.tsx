import { RowsPhotoAlbum } from "react-photo-album";
import "react-photo-album/rows.css";
export interface GridItem { key: string; src: string; width: number; height: number; label?: string }
/** Isolation wrapper around react-photo-album (single-maintainer dep). */
export function PhotoGrid({ items, onClick }: { items: GridItem[]; onClick: (index: number) => void }) {
  return (
    <RowsPhotoAlbum
      photos={items.map((it) => ({ key: it.key, src: it.src, width: it.width, height: it.height, alt: it.label ?? "" }))}
      targetRowHeight={96}
      spacing={6}
      onClick={({ index }) => onClick(index)}
    />
  );
}
