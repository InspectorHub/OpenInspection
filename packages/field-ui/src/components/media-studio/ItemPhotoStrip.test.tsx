// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ItemPhotoStrip } from './ItemPhotoStrip';

afterEach(cleanup);

function strip(over: Partial<React.ComponentProps<typeof ItemPhotoStrip>> = {}) {
  const onAddPhoto = vi.fn();
  render(
    <ItemPhotoStrip
      inspectionId="insp-1"
      itemId="item-1"
      photos={[]}
      coverKey={null}
      photoUrl={(key) => `/photo/${key}`}
      onAddPhoto={onAddPhoto}
      onOpen={() => {}}
      {...over}
    />,
  );
  return { onAddPhoto };
}

describe('ItemPhotoStrip add tile', () => {
  it('lets the person add the next photo while earlier ones are still uploading (the upload queue takes more batches; blocking the tile stopped an inspector from carrying on)', () => {
    const { onAddPhoto } = strip({ photoUploading: true });
    const add = screen.getByTestId('photo-add');
    expect(add.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(add);
    expect(onAddPhoto).toHaveBeenCalledTimes(1);
  });

  it('still tells the person an upload is running, without taking the plus away', () => {
    strip({ photoUploading: true });
    const add = screen.getByTestId('photo-add');
    expect(add.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByTestId('photo-add-uploading')).toBeTruthy();
    expect(add.querySelector('path[d="M12 4v16m8-8H4"]')).not.toBeNull();
  });

  it('control: when nothing is uploading the tile is a plain plus with no busy mark', () => {
    const { onAddPhoto } = strip({ photoUploading: false });
    const add = screen.getByTestId('photo-add');
    expect(add.getAttribute('aria-busy')).toBeNull();
    expect(screen.queryByTestId('photo-add-uploading')).toBeNull();
    fireEvent.click(add);
    expect(onAddPhoto).toHaveBeenCalledTimes(1);
  });
});
