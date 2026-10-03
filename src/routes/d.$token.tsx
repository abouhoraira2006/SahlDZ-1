import { createFileRoute } from "@tanstack/react-router";
import { PublicMenuPage } from "@/pages/public-menu-page";

export const Route = createFileRoute("/d/$token")({
  component: DeliveryRoute,
});

function DeliveryRoute() {
  const { token } = Route.useParams();
  return <PublicMenuPage token={token} mode="delivery" />;
}
