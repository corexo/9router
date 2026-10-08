fetch("http://127.0.0.1:20128/api/health")
  .then(async (response) => {
    const body = await response.text();
    if (!response.ok) process.exitCode = 1;
    else process.stdout.write(body);
  })
  .catch(() => { process.exitCode = 1; });
