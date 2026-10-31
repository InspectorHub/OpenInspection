import type { CommandResult } from '../../commands';
import { m } from '../../i18n';
import { posterRefusal } from '../../shared/photo-admission';

/**
 * The poster key for an R2 video, or undefined when there is none. The poster is optional, so a poster the route would
 * refuse (over the photo ceiling, or not jpeg, png or webp by its bytes) is neither sent nor fatal: the person hears
 * once, with a fixed sentence, that the video went up without a preview image.
 */
export async function posterKeyIfAdmissible(
    poster: Blob,
    upload: () => Promise<CommandResult<{ posterKey: string }>>,
    notify: (message: string, variant: 'warning') => void,
): Promise<string | undefined> {
    if ((await posterRefusal(poster)) !== null) {
        notify(m.media_video_poster_skipped(), 'warning');
        return undefined;
    }
    const res = await upload();
    return res.ok ? res.data?.posterKey : undefined;
}
