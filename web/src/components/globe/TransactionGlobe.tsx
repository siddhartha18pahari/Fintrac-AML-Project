"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CANADA_LL, COUNTRY_LL, type GlobeCountry } from "@/components/globe/coords";

type ArcSpec = {
  key: string;
  from: [number, number];
  to: [number, number];
  color: string;
  lift: number;
  speed: number;
  radius: number;
};

function latLon([lat, lon]: [number, number], radius: number) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function buildArcs(countries: GlobeCountry[]): ArcSpec[] {
  const arcs: ArcSpec[] = [];
  for (const country of countries) {
    const there = COUNTRY_LL[country.code];
    if (!there || country.code === "CA") continue;
    if (country.outgoing_cad > 0) {
      arcs.push({
        key: `out-${country.code}`,
        from: CANADA_LL,
        to: there,
        color: "#e2c48a",
        lift: 1.28,
        speed: 0.16 + Math.min(0.12, country.outgoing_cad / 400000),
        radius: 0.0036 + Math.min(0.006, country.outgoing_cad / 9_000_000),
      });
    }
    if (country.incoming_cad > 0) {
      arcs.push({
        key: `in-${country.code}`,
        from: there,
        to: CANADA_LL,
        color: "#7ee0c6",
        lift: 1.46,
        speed: 0.14 + Math.min(0.1, country.incoming_cad / 400000),
        radius: 0.0036 + Math.min(0.006, country.incoming_cad / 9_000_000),
      });
    }
  }
  return arcs;
}

function Dust({ count }: { count: number }) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let index = 0; index < count; index += 1) {
      const y = 1 - (index / Math.max(1, count - 1)) * 2;
      const ring = Math.sqrt(1 - y * y);
      const theta = golden * index;
      const radius = 1.012;
      positions[index * 3] = Math.cos(theta) * ring * radius;
      positions[index * 3 + 1] = y * radius;
      positions[index * 3 + 2] = Math.sin(theta) * ring * radius;
      const brass = (index * 17) % 11 === 0;
      colors[index * 3] = brass ? 0.89 : 0.52;
      colors[index * 3 + 1] = brass ? 0.77 : 0.86;
      colors[index * 3 + 2] = brass ? 0.54 : 0.76;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [count]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <points geometry={geometry}>
      <pointsMaterial size={0.016} vertexColors transparent opacity={0.92} depthWrite={false} sizeAttenuation />
    </points>
  );
}

function Stars({ count }: { count: number }) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const radius = 5.5 + Math.random() * 7;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[index * 3 + 2] = radius * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [count]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <points geometry={geometry}>
      <pointsMaterial color="#d5e7df" size={0.018} transparent opacity={0.75} depthWrite={false} sizeAttenuation />
    </points>
  );
}

function Graticule() {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const push = (left: THREE.Vector3, right: THREE.Vector3) => {
      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    };
    for (let lat = -60; lat <= 60; lat += 30) {
      let previous: THREE.Vector3 | null = null;
      for (let lon = -180; lon <= 180; lon += 6) {
        const point = latLon([lat, lon], 1.02);
        if (previous) push(previous, point);
        previous = point;
      }
    }
    for (let lon = -150; lon <= 180; lon += 30) {
      let previous: THREE.Vector3 | null = null;
      for (let lat = -80; lat <= 80; lat += 6) {
        const point = latLon([lat, lon], 1.02);
        if (previous) push(previous, point);
        previous = point;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#9ad7c4" transparent opacity={0.32} />
    </lineSegments>
  );
}

function Arc({ spec, animate }: { spec: ArcSpec; animate: boolean }) {
  const traveler = useRef<THREE.Mesh>(null);
  const curve = useMemo(() => {
    const start = latLon(spec.from, 1.03);
    const end = latLon(spec.to, 1.03);
    const mid = start.clone().add(end).multiplyScalar(0.5).normalize().multiplyScalar(spec.lift);
    return new THREE.QuadraticBezierCurve3(start, mid, end);
  }, [spec]);

  useFrame(({ clock }) => {
    const mesh = traveler.current;
    if (!mesh) return;
    const progress = animate ? (clock.elapsedTime * spec.speed + spec.lift) % 1 : 0.46;
    mesh.position.copy(curve.getPoint(progress));
  });

  return (
    <group>
      <mesh>
        <tubeGeometry args={[curve, 56, spec.radius * 2.4, 6, false]} />
        <meshBasicMaterial color={spec.color} transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <mesh>
        <tubeGeometry args={[curve, 56, spec.radius, 6, false]} />
        <meshBasicMaterial color={spec.color} transparent opacity={0.92} />
      </mesh>
      <mesh ref={traveler}>
        <sphereGeometry args={[0.02, 12, 12]} />
        <meshBasicMaterial color="#fff8ea" />
      </mesh>
    </group>
  );
}

function Marker({ at, color, animate }: { at: [number, number]; color: string; animate: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const position = useMemo(() => latLon(at, 1.04), [at]);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const pulse = animate ? 1 + Math.sin(clock.elapsedTime * 2.2) * 0.18 : 1;
    mesh.scale.setScalar(pulse);
  });
  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[0.028, 16, 16]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

function DragGlobe({
  spin,
  interactive,
  children,
}: {
  spin: boolean;
  interactive: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  const drag = useRef({ active: false, x: 0, y: 0 });

  useFrame((_, delta) => {
    if (spin && !drag.current.active && ref.current) ref.current.rotation.y += delta * 0.16;
  });

  return (
    <group
      ref={ref}
      rotation={[0.18, 0.78, 0]}
      onPointerDown={(event) => {
        if (!interactive) return;
        drag.current = { active: true, x: event.clientX, y: event.clientY };
      }}
      onPointerUp={() => {
        drag.current.active = false;
      }}
      onPointerLeave={() => {
        drag.current.active = false;
      }}
      onPointerMove={(event) => {
        if (!interactive || !drag.current.active || !ref.current) return;
        const dx = event.clientX - drag.current.x;
        const dy = event.clientY - drag.current.y;
        drag.current.x = event.clientX;
        drag.current.y = event.clientY;
        ref.current.rotation.y += dx * 0.005;
        ref.current.rotation.x = Math.max(-0.65, Math.min(0.7, ref.current.rotation.x + dy * 0.003));
      }}
    >
      {children}
    </group>
  );
}

function WheelZoom({ enabled }: { enabled: boolean }) {
  const { camera, gl } = useThree();
  useEffect(() => {
    if (!enabled) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!(camera instanceof THREE.PerspectiveCamera)) return;
      camera.position.z = THREE.MathUtils.clamp(camera.position.z + event.deltaY * 0.002, 2.25, 5.4);
    };
    gl.domElement.addEventListener("wheel", onWheel, { passive: false });
    return () => gl.domElement.removeEventListener("wheel", onWheel);
  }, [camera, enabled, gl]);
  return null;
}

function Scene({
  countries,
  interactive,
  animate,
  quality,
}: {
  countries: GlobeCountry[];
  interactive: boolean;
  animate: boolean;
  quality: "high" | "low";
}) {
  const arcs = useMemo(() => buildArcs(countries), [countries]);
  const markers = useMemo(() => {
    const seen = new Map<string, [number, number]>();
    seen.set("CA", CANADA_LL);
    for (const country of countries) {
      const point = COUNTRY_LL[country.code];
      if (point) seen.set(country.code, point);
    }
    return [...seen.entries()];
  }, [countries]);

  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[4.5, 2.2, 3.4]} intensity={1.55} color="#f4e4c4" />
      <directionalLight position={[-3.5, -1.2, -2]} intensity={0.45} color="#7ee0c6" />
      <Stars count={quality === "high" ? 700 : 280} />
      {interactive ? <WheelZoom enabled /> : null}
      <DragGlobe spin={animate} interactive={interactive}>
        <mesh>
          <sphereGeometry args={[1, quality === "high" ? 64 : 40, quality === "high" ? 64 : 40]} />
          <meshStandardMaterial color="#14312a" metalness={0.42} roughness={0.58} />
        </mesh>
        <mesh>
          <sphereGeometry args={[1.14, 48, 48]} />
          <shaderMaterial
            transparent
            depthWrite={false}
            side={THREE.BackSide}
            glslVersion={THREE.GLSL3}
            vertexShader={`
              out vec3 vNormal;
              void main() {
                vNormal = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              }
            `}
            fragmentShader={`
              in vec3 vNormal;
              out vec4 fragColor;
              void main() {
                float fresnel = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.1);
                fragColor = vec4(0.62, 0.93, 0.82, fresnel * 0.95);
              }
            `}
          />
        </mesh>
        <Dust count={quality === "high" ? 1600 : 700} />
        <Graticule />
        <mesh rotation={[Math.PI / 2.15, 0.2, 0.1]}>
          <torusGeometry args={[1.22, 0.0035, 12, quality === "high" ? 140 : 80]} />
          <meshBasicMaterial color="#e2c48a" transparent opacity={0.45} />
        </mesh>
        {arcs.map((spec) => (
          <Arc key={spec.key} spec={spec} animate={animate} />
        ))}
        {markers.map(([code, at]) => (
          <Marker key={code} at={at} color={code === "CA" ? "#fff4d2" : "#9ad7c4"} animate={animate} />
        ))}
      </DragGlobe>
    </>
  );
}

export function TransactionGlobe({
  countries,
  interactive,
  animate,
  quality,
}: {
  countries: GlobeCountry[];
  interactive: boolean;
  animate: boolean;
  quality: "high" | "low";
}) {
  return (
    <Canvas
      camera={{ position: [0, 0.28, 3.25], fov: 40 }}
      dpr={quality === "high" ? [1, 1.5] : [1, 1.15]}
      frameloop={animate || interactive ? "always" : "demand"}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
      }}
      style={{ width: "100%", height: "100%" }}
      aria-hidden="true"
    >
      <Scene countries={countries} interactive={interactive} animate={animate} quality={quality} />
    </Canvas>
  );
}
