import { Header } from "@/components/layout/Header";
import { MobileNav } from "@/components/layout/MobileNav";
import { ActiveMeetingBanner } from "@/components/audio/ActiveMeetingBanner";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col max-w-full overflow-x-hidden">
      <Header />
      <ActiveMeetingBanner />
      <div className="flex-1 flex overflow-hidden w-full max-w-full">
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-8 max-w-7xl mx-auto w-full pb-24 md:pb-8">
          {children}
        </main>
      </div>
      <MobileNav />
    </div>

  );
}

