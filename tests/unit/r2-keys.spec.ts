import { describe, it, expect } from 'vitest';
import { r2Keys } from '../../server/lib/r2-keys';

describe('r2Keys', () => {
  const t = 'TEN', i = 'INSP', m = 'MED';
  it('inspection-scoped keys', () => {
    expect(r2Keys.inspectionPhoto(t, i, m, 'jpg')).toBe('TEN/inspections/INSP/photos/MED.jpg');
    expect(r2Keys.inspectionPhotoAnnotated(t, i, m)).toBe('TEN/inspections/INSP/photos/MED.annotated.png');
    expect(r2Keys.inspectionPhotoCropped(t, i, m)).toBe('TEN/inspections/INSP/photos/MED.cropped.jpg');
    expect(r2Keys.inspectionVideo(t, i, m, 'mp4')).toBe('TEN/inspections/INSP/videos/MED.mp4');
    expect(r2Keys.inspectionVideoPoster(t, i, m)).toBe('TEN/inspections/INSP/videos/MED.poster.jpg');
    expect(r2Keys.inspectionCover(t, i, m)).toBe('TEN/inspections/INSP/cover/MED.jpg');
    expect(r2Keys.inspectionDocument(t, i, 'D', 'a.pdf')).toBe('TEN/inspections/INSP/documents/D-a.pdf');
    expect(r2Keys.agreementFile(t, i, 'ENV', 'signed.pdf')).toBe('TEN/inspections/INSP/agreements/ENV/signed.pdf');
  });
  it('tenant/user scoped keys', () => {
    expect(r2Keys.brandingLogo(t, m, 'png')).toBe('TEN/branding/logo-MED.png');
    expect(r2Keys.inspectorPhoto(t, 'U', 'jpg')).toBe('TEN/inspector-photos/U.jpg');
    expect(r2Keys.inspectorPhotoServe(t, 'U.jpg')).toBe('TEN/inspector-photos/U.jpg');
    expect(r2Keys.messageAttachment(t, 'MSG', 'ATT', 'png')).toBe('TEN/messages/MSG/ATT.png');
  });
});
