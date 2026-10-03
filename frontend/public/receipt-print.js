document.getElementById('print').addEventListener('click', async () => {
  await Promise.all(
    [...document.images].map((image) =>
      image.decode().catch(() => undefined),
    ),
  );
  window.print();
});
