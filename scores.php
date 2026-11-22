<?php
// Classement Pirate Flipper : stockage JSON dans scores.json (créé automatiquement).
// GET  scores.php            -> {"scores":[{"name":"ABC","score":1234,"date":"2026-11-21"},...]}
// POST scores.php (name, score) -> enregistre puis renvoie le classement + "rank"
const NAME_LEN = 3;        // nombre de lettres du pseudo (mets 10 pour des pseudos plus longs)
const KEEP     = 100;      // scores conservés
const SHOW     = 10;       // scores renvoyés
const MAX_SCORE = 50000000; // plafond anti-triche grossier
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$file = __DIR__ . '/scores.json';
$fh = fopen($file, 'c+');
if (!$fh) { http_response_code(500); echo '{"error":"stockage"}'; exit; }
flock($fh, LOCK_EX);
$raw = stream_get_contents($fh);
$list = json_decode($raw ?: '[]', true); if (!is_array($list)) $list = [];
$rank = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $name = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $_POST['name'] ?? ''));
  $name = substr($name, 0, NAME_LEN);
  $score = (int)($_POST['score'] ?? 0);
  if ($name === '' || $score <= 0 || $score > MAX_SCORE) { http_response_code(400); echo '{"error":"invalide"}'; flock($fh, LOCK_UN); exit; }
  // anti-spam : 1 envoi / 3 s par IP
  $ipf = sys_get_temp_dir() . '/pf_' . md5($_SERVER['REMOTE_ADDR'] ?? '');
  if (file_exists($ipf) && time() - filemtime($ipf) < 3) { http_response_code(429); echo '{"error":"trop vite"}'; flock($fh, LOCK_UN); exit; }
  @touch($ipf);
  $entry = ['name' => $name, 'score' => $score, 'date' => date('Y-m-d'), 'id' => bin2hex(random_bytes(4))];
  $list[] = $entry;
  usort($list, fn($a, $b) => $b['score'] <=> $a['score']);
  $list = array_slice($list, 0, KEEP);
  foreach ($list as $i => $e) if ($e['id'] === $entry['id']) { $rank = $i + 1; break; }
  ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($list));
} else usort($list, fn($a, $b) => $b['score'] <=> $a['score']);
flock($fh, LOCK_UN); fclose($fh);
$out = array_map(fn($e) => ['name' => $e['name'], 'score' => $e['score'], 'date' => $e['date']], array_slice($list, 0, SHOW));
echo json_encode(['scores' => $out, 'rank' => $rank, 'nameLen' => NAME_LEN]);
