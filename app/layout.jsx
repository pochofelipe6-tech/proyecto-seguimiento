import "../dist/styles.css";
import "leaflet/dist/leaflet.css";

export const metadata = {
  title: "Ruta Segura SST",
  description: "Seguimiento de vehículos, kilometraje y alertas de velocidad.",
};

export default function RootLayout({ children }) {
  return <html lang="es"><body>{children}</body></html>;
}
