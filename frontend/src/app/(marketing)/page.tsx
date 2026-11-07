import type { Metadata } from "next";
import { Hero } from "./_components/hero";
import { Problem } from "./_components/problem";
import { HowItWorks } from "./_components/how-it-works";
import { Features } from "./_components/features";
import { AppShowcase } from "./_components/app-showcase";
import { Testimonials } from "./_components/testimonials";
import { FaqSection } from "./_components/faq-section";
import { Cta } from "./_components/cta";
import { ContactForm } from "./_components/contact-form";

export const metadata: Metadata = {
  title: "Reidey — Driver Management",
  description:
    "Reidey — Driver Management.",
};

export default function LandingPage() {
  return (
    <>
      <Hero />
      <Problem />
      <HowItWorks />
      <Features />
      <AppShowcase />
      <Testimonials />
      <FaqSection />
      <Cta />
      <ContactForm />
    </>
  );
}
