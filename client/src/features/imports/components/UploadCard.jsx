import { useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { errorMessage } from '@/features/auth/components/FormError.jsx';
import { downloadTemplate } from '@/features/imports/api.js';
import { ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';

function uploadError(error) {
  if (error instanceof ApiError && error.code === 'FILE_TYPE_NOT_ALLOWED') {
    return t('imports.fileType');
  }
  if (error instanceof ApiError && error.code === 'FILE_TOO_LARGE') {
    return t('imports.fileTooLarge');
  }
  return errorMessage(error);
}

export function UploadCard({ departmentId, upload, onUploaded }) {
  const [file, setFile] = useState(null);
  const [templateFailed, setTemplateFailed] = useState(false);

  function submit(event) {
    event.preventDefault();
    if (!file) return;
    upload.mutate({ file }, { onSuccess: (imp) => onUploaded(imp.id) });
  }
  async function template() {
    setTemplateFailed(false);
    try {
      await downloadTemplate(departmentId);
    } catch {
      setTemplateFailed(true);
    }
  }
  const message = upload.error ? uploadError(upload.error) : null;

  return (
    <section className="space-y-3 rounded-md border p-4">
      <Button type="button" variant="secondary" onClick={template}>
        {t('imports.template')}
      </Button>
      {templateFailed && (
        <p role="alert" className="text-sm text-destructive">
          {t('imports.templateFailed')}
        </p>
      )}
      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="import-file" className="block text-sm font-medium">
          {t('imports.uploadLabel')}
        </label>
        <input
          id="import-file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
        <p className="text-sm text-muted-foreground">{t('imports.uploadHint')}</p>
        <Button type="submit" disabled={!file || upload.isPending}>
          {upload.isPending ? t('imports.uploading') : t('imports.upload')}
        </Button>
        <div role="alert" aria-live="polite">
          {message && (
            <p className="rounded-md border border-destructive p-3 text-sm text-destructive">
              {message}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
