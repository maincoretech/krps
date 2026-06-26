<script>
  import { toasts } from "./toast.js";
</script>

<div class="toast-container">
  {#each $toasts as t (t.id)}
    <div class="toast-item toast-{t.type}">
      <div class="toast-content">{t.message}</div>
      <div class="toast-progress" style="animation-duration: {t.duration}ms"></div>
    </div>
  {/each}
</div>
