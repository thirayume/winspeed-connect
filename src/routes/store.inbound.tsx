import { createFileRoute } from "@tanstack/react-router";
import { InboundQueue } from "@/components/store/InboundQueue";

export const Route = createFileRoute("/store/inbound")({
  component: () => <InboundQueue />,
});
