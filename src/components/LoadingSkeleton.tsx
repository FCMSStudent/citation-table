export function LoadingSkeleton() {
  const rows = Array.from({ length: 8 }, (_, i) => i);
  
  return (
    <div className="w-full animate-pulse">
      <div className="mb-4 h-5 bg-muted rounded w-64"></div>
      
      <div className="border border-border rounded-lg overflow-hidden bg-card">
        <table className="results-table">
          <thead>
            <tr>
              <th className="w-8"><div className="h-4 bg-muted/50 rounded w-4"></div></th>
              <th><div className="h-4 bg-muted/50 rounded w-32"></div></th>
              <th><div className="h-4 bg-muted/50 rounded w-12"></div></th>
              <th><div className="h-4 bg-muted/50 rounded w-20"></div></th>
              <th><div className="h-4 bg-muted/50 rounded w-8"></div></th>
              <th><div className="h-4 bg-muted/50 rounded w-24"></div></th>
              <th><div className="h-4 bg-muted/50 rounded w-32"></div></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i} className="skeleton-row">
                <td><div className="skeleton-cell w-4"></div></td>
                <td><div className="skeleton-cell w-full max-w-md"></div></td>
                <td><div className="skeleton-cell w-12"></div></td>
                <td><div className="skeleton-cell w-16"></div></td>
                <td><div className="skeleton-cell w-10"></div></td>
                <td><div className="skeleton-cell w-full max-w-xs"></div></td>
                <td><div className="skeleton-cell w-full max-w-sm"></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
