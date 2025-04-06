let score = 0;
document.getElementById('clickMe').addEventListener('click', () => {
    score++;
    document.getElementById('score').textContent = score;
});
