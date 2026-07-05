import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { Marquee } from "@/components/Marquee";
import { Features } from "@/components/Features";
import { ThemesShowcase } from "@/components/ThemesShowcase";
import { Philosophy } from "@/components/Philosophy";
import { Download } from "@/components/Download";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Features />
        <ThemesShowcase />
        <Philosophy />
        <Download />
      </main>
      <Footer />
    </>
  );
}
