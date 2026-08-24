import React from 'react';

/**
 * Clickable table header toggles ascending / descending sort.
 */
export default function SortableTh({
  columnId,
  sortCol,
  sortDir,
  onSort,
  children,
  className = '',
  align,
  style: userStyle,
  ...rest
}) {
  const active = sortCol === columnId;
  const mergedStyle = {
    cursor: 'pointer',
    userSelect: 'none',
    ...(align ? { textAlign: align } : {}),
    ...(userStyle || {}),
  };
  return (
    <th
      {...rest}
      className={`data-table-sortable ${className}`.trim()}
      style={mergedStyle}
      role="columnheader"
      scope="col"
      aria-sort={
        active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined
      }
      onClick={(e) => {
        e.stopPropagation();
        onSort(columnId);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onSort(columnId);
        }
      }}
      tabIndex={0}
    >
      <span style={{ verticalAlign: 'middle' }}>
        {children}
        {/*
          Classed, not bare text: the arrow is a control, not part of the column's name, and the
          CSV export strips it by that class. Without it a downloaded file had "Ism ▲" as a
          heading — and the arrow moves as you sort, so the heading changed between downloads.
        */}
        {active ? <span className="sort-indicator">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span> : ''}
      </span>
    </th>
  );
}
