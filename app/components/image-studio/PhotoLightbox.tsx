import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
export interface LightboxSlide { src: string; alt?: string }
/** Isolation wrapper around yet-another-react-lightbox (single-maintainer dep). */
export function PhotoLightbox({ slides, index, open, onClose }: {
  slides: LightboxSlide[]; index: number; open: boolean; onClose: () => void;
}) {
  return <Lightbox open={open} close={onClose} index={index} slides={slides} />;
}
