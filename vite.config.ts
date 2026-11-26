import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// GitHub Pages 주소(chitada7.github.io/family-schedule/)에 맞춘 경로
export default defineConfig({ base: '/family-schedule/', plugins: [react()] });
