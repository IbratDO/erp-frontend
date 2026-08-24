import React from 'react';
import useAppTranslation from '../hooks/useAppTranslation';
import { csvFilename, downloadCsv, matrixToCsv, tableToMatrix } from '../utils/tableCsv';

/**
 * "Excel'ga yuklab olish" — saves the table beside it as a CSV Excel opens.
 *
 * Takes a ref to the `<table>` rather than the data behind it, so what lands in the file is what
 * is on the screen: the rows the current filters left, in the order the current sort put them.
 * See `utils/tableCsv` for why that is the right way round.
 *
 * Renders nothing when the table is empty — offering to download nothing is a worse answer than
 * not offering.
 */
export default function TableDownloadButton({ tableRef, filename, rowCount, className = '' }) {
  const { t } = useAppTranslation(['common']);

  if (rowCount === 0) return null;

  const handleClick = () => {
    const matrix = tableToMatrix(tableRef?.current);
    if (!matrix.length) return;
    downloadCsv(csvFilename(filename), matrixToCsv(matrix));
  };

  return (
    <button
      type="button"
      className={`btn-edit table-download-btn ${className}`.trim()}
      onClick={handleClick}
      title={t('actions.downloadExcelHint')}
    >
      {t('actions.downloadExcel')}
    </button>
  );
}
