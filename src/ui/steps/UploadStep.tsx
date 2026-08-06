import { useCallback, useRef, useState } from 'react';
import { DEFAULT_ACCEPTED_EXTENSIONS, fileExtension } from '../../parsers';
import type { CustomFileParser, Field, Settings } from '../../types';
import { Button } from '../components/Button';
import { DownloadIcon, TableIcon, UploadIcon } from '../components/Icons';
import { downloadTemplate } from '../../core/template';

interface UploadStepProps {
  settings: Settings;
  fields: Field[];
  fileParsers?: CustomFileParser[];
  onFile: (file: File) => void;
  onManualEntry: () => void;
  onError: (message: string) => void;
}

export function UploadStep({
  settings,
  fields,
  fileParsers,
  onFile,
  onManualEntry,
  onError,
}: UploadStepProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const accepted = [
    ...DEFAULT_ACCEPTED_EXTENSIONS,
    ...(fileParsers ?? []).flatMap((parser) => parser.extensions.map((e) => e.replace(/^\./, ''))),
  ];
  const acceptAttribute = accepted.map((extension) => `.${extension}`).join(',');

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;

      const extension = fileExtension(file.name);
      if (extension !== '' && !accepted.includes(extension)) {
        onError(
          `.${extension} files are not supported. Choose one of: ${accepted
            .map((e) => `.${e}`)
            .join(', ')}.`,
        );
        return;
      }
      onFile(file);
    },
    [accepted, onError, onFile],
  );

  const templateName = settings.templateDownloadFilename;
  const templateUrl = settings.uploadStep?.templateDownloadOverrideURL;

  return (
    <>
      {settings.uploadStep?.helpText && (
        <div className="rsu-help">{settings.uploadStep.helpText}</div>
      )}

      {!settings.manualInputOnly && (
      <div
        className={`rsu-dropzone${dragging ? ' rsu-dropzone--active' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Choose a file to upload"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
      >
        <UploadIcon size={30} className="rsu-dropzone-icon" />
        <span className="rsu-dropzone-title">Drop a file here, or click to browse</span>
        <span className="rsu-dropzone-hint">
          {accepted.map((extension) => `.${extension}`).join(', ')}
        </span>

        <input
          ref={inputRef}
          type="file"
          accept={acceptAttribute}
          hidden
          onChange={(event) => {
            handleFiles(event.target.files);
            // Reset so re-picking the same file fires another change event.
            event.target.value = '';
          }}
        />
      </div>
      )}

      {(templateName || templateUrl) && (
        <div className="rsu-upload-actions">
          <Button
            variant="tertiary"
            onClick={() => {
              if (templateUrl) {
                window.open(templateUrl, '_blank', 'noopener,noreferrer');
              } else {
                downloadTemplate(fields, templateName ?? 'import-template.csv');
              }
            }}
          >
            <DownloadIcon size={14} />
            Download template
          </Button>
        </div>
      )}

      {!settings.manualInputDisabled && (
        <>
          <div className="rsu-or" role="separator">
            <span>or</span>
          </div>
          <div className="rsu-upload-actions">
            <Button variant="secondary" onClick={onManualEntry}>
              <TableIcon size={15} />
              Enter your data by hand
            </Button>
          </div>
        </>
      )}
    </>
  );
}
