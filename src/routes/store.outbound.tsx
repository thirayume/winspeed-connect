import { createFileRoute } from "@tanstack/react-router";
import { OutboundQueue } from "@/components/store/OutboundQueue";

export const Route = createFileRoute("/store/outbound")({
  component: () => <OutboundQueue />,
});
