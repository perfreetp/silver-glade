<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Viewer } from '../lib/render/viewer';
  import type { Fan } from '../lib/model/room';
  import type { Solution } from '../lib/solver/field';

  let { fans = [], onFanDragMove, onFanDragEnd }: {
    fans: Fan[];
    onFanDragMove?: (id: string, u: number, v: number) => void;
    onFanDragEnd?: (id: string) => void;
  } = $props();

  let host: HTMLDivElement;
  let viewer: Viewer | null = null;

  onMount(() => {
    viewer = new Viewer(host);
    viewer.setEvents({ onFanDragMove, onFanDragEnd });
    viewer.setFans(fans);
    viewer.observe();
    return () => {
      viewer?.dispose();
      viewer = null;
    };
  });

  // 外部更新风机列表
  $effect(() => {
    if (viewer && fans) viewer.setFans(fans);
  });

  export function setSolution(sol: Solution, opts?: { reseed?: boolean }) {
    viewer?.setSolution(sol, opts);
  }
  export function setFans(f: Fan[]) {
    viewer?.setFans(f);
  }
  export function setSlice(mode: any, pos: number) {
    viewer?.setSlice(mode, pos);
  }
  export function setSettings(s: any) {
    viewer?.setSettings(s);
  }
  export function resetCamera() {
    viewer?.resetCamera();
  }
  export function preset(p: 'iso' | 'front' | 'top' | 'side') {
    viewer?.setCameraPreset(p);
  }
</script>

<div class="viewer" bind:this={host}></div>

<style>
  .viewer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
</style>
