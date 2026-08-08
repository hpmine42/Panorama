import { forwardRef, useImperativeHandle, useRef } from 'react';

export interface ImagePickerHandle {
  open(): void;
}

interface ImagePickerProps {
  onFile(file: File): void;
  disabled?: boolean;
}

export const ImagePicker = forwardRef<ImagePickerHandle, ImagePickerProps>(
  function ImagePicker({ onFile, disabled = false }, ref) {
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      open() {
        if (disabled) return;
        // Resetting the value also lets the user select the same file twice.
        if (inputRef.current) inputRef.current.value = '';
        inputRef.current?.click();
      },
    }), [disabled]);

    return (
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif"
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onFile(file);
        }}
      />
    );
  },
);
