// The schedule workspace is full-viewport — bypass the dashboard layout's p-8 wrapper.
export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return <div className="-m-8 overflow-hidden">{children}</div>;
}
