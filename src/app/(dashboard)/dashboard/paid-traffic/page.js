import PaidTrafficClient from "./PaidTrafficClient";

export const dynamic = "force-dynamic";

export default function PaidTrafficPage() {
  return <div className="mx-auto w-full max-w-7xl space-y-4 p-4 lg:p-6">
    <div><h1 className="text-xl font-semibold text-text-main">Paid Traffic</h1><p className="text-sm text-zinc-400">Jev-allokáció, paid usage és döntési előzmények. Free modellek kizárva.</p></div>
    <PaidTrafficClient />
  </div>;
}
