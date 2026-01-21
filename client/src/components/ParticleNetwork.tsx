import { useEffect, useRef, useCallback } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  opacity: number;
}

interface ParticleNetworkProps {
  className?: string;
  particleCount?: number;
  connectionDistance?: number;
  particleColor?: string;
  lineColor?: string;
  speed?: number;
}

/**
 * 动态粒子网络背景组件
 * 创建一个带有连接线的粒子动画效果，象征数据连接和网络搜索
 */
export function ParticleNetwork({
  className = '',
  particleCount = 50,
  connectionDistance = 150,
  particleColor = 'rgba(56, 189, 248, 0.8)',
  lineColor = 'rgba(56, 189, 248, 0.15)',
  speed = 0.5,
}: ParticleNetworkProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number>();
  const mouseRef = useRef({ x: 0, y: 0, isInCanvas: false });

  // 初始化粒子
  const initParticles = useCallback((width: number, height: number) => {
    const particles: Particle[] = [];
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * speed,
        vy: (Math.random() - 0.5) * speed,
        radius: Math.random() * 2 + 1,
        opacity: Math.random() * 0.5 + 0.3,
      });
    }
    particlesRef.current = particles;
  }, [particleCount, speed]);

  // 绘制粒子和连接线
  const draw = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.clearRect(0, 0, width, height);
    const particles = particlesRef.current;

    // 更新粒子位置
    particles.forEach((particle) => {
      particle.x += particle.vx;
      particle.y += particle.vy;

      // 边界反弹
      if (particle.x < 0 || particle.x > width) particle.vx *= -1;
      if (particle.y < 0 || particle.y > height) particle.vy *= -1;

      // 鼠标交互 - 粒子被鼠标吸引
      if (mouseRef.current.isInCanvas) {
        const dx = mouseRef.current.x - particle.x;
        const dy = mouseRef.current.y - particle.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 200) {
          particle.vx += dx * 0.0001;
          particle.vy += dy * 0.0001;
        }
      }

      // 限制速度
      const maxSpeed = speed * 2;
      particle.vx = Math.max(-maxSpeed, Math.min(maxSpeed, particle.vx));
      particle.vy = Math.max(-maxSpeed, Math.min(maxSpeed, particle.vy));
    });

    // 绘制连接线
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < connectionDistance) {
          const opacity = (1 - dist / connectionDistance) * 0.5;
          ctx.beginPath();
          ctx.strokeStyle = lineColor.replace('0.15', opacity.toString());
          ctx.lineWidth = 1;
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }

      // 鼠标连接线
      if (mouseRef.current.isInCanvas) {
        const dx = mouseRef.current.x - particles[i].x;
        const dy = mouseRef.current.y - particles[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < connectionDistance * 1.5) {
          const opacity = (1 - dist / (connectionDistance * 1.5)) * 0.8;
          ctx.beginPath();
          ctx.strokeStyle = `rgba(139, 92, 246, ${opacity})`;
          ctx.lineWidth = 1.5;
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(mouseRef.current.x, mouseRef.current.y);
          ctx.stroke();
        }
      }
    }

    // 绘制粒子
    particles.forEach((particle) => {
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      ctx.fillStyle = particleColor.replace('0.8', particle.opacity.toString());
      ctx.fill();

      // 添加发光效果
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius * 2, 0, Math.PI * 2);
      const gradient = ctx.createRadialGradient(
        particle.x, particle.y, 0,
        particle.x, particle.y, particle.radius * 2
      );
      gradient.addColorStop(0, particleColor.replace('0.8', (particle.opacity * 0.3).toString()));
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fill();
    });
  }, [connectionDistance, lineColor, particleColor, speed]);

  // 动画循环
  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    draw(ctx, canvas.width, canvas.height);
    animationRef.current = requestAnimationFrame(animate);
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 设置 canvas 尺寸
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      initParticles(canvas.width, canvas.height);
    };

    // 鼠标移动事件
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        isInCanvas: true,
      };
    };

    const handleMouseLeave = () => {
      mouseRef.current.isInCanvas = false;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    // 开始动画
    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [animate, initParticles]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full ${className}`}
      style={{ pointerEvents: 'auto' }}
    />
  );
}

export default ParticleNetwork;
