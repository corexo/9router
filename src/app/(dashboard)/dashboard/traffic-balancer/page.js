import DynamicTrafficBalancer from "./DynamicTrafficBalancer";

export const dynamic = "force-dynamic";

export default function TrafficBalancerPage() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-semibold text-text-main">Traffic Balancer</h1>
        <p className="text-sm text-zinc-400">
          Multi-Provider-Traffic-Balancer: dynamische Account-Gewichtung pro Provider.
        </p>
      </div>
      <DynamicTrafficBalancer />
    </div>
  );
}
