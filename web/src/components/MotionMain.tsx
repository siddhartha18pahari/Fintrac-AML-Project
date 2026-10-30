"use client";

import { motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";

export function MotionMain({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const reduce = useReducedMotion() === true;
  return (
    <motion.div
      key={path}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
