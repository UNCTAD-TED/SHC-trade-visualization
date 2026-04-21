const express = require('express');
const app = express();
const path = require('path');
const port = process.env.PORT || 8080;

// すべての静的ファイル（JS, CSS, Data）を公開する設定
app.use(express.static(__dirname));

// サイトにアクセスしたら index.html を返す
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
  console.log('Server is running on port', port);
});
