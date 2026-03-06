// public/js/theme.js

// Function to set a theme, update classes, local storage, and text
function setTheme(theme) {
    const themeText = document.getElementById('currentThemeText');
    const themeToggle = document.getElementById('theme-toggle');
    const toggleIcon = themeToggle.querySelector('.material-icons');

    if (theme === 'dark') {
        document.body.classList.add('dark-mode');
        localStorage.setItem('theme', 'dark');
        themeText.innerText = 'Current Theme: DARK';
        toggleIcon.innerText = 'light_mode'; // icon to switch back
    } else {
        document.body.classList.remove('dark-mode');
        localStorage.setItem('theme', 'light');
        themeText.innerText = 'Current Theme: LIGHT (Default)';
        toggleIcon.innerText = 'dark_mode'; // icon to switch
    }
}

// Initial set up on page load
function initTheme() {
    const storedTheme = localStorage.getItem('theme');
    const userPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

    // Default to 'light' unless user specifically stored 'dark' or prefers dark scheme.
    // In our fix, the default should be light to fix the 'Brack' issue.
    if (storedTheme === 'dark' || (userPrefersDark && !storedTheme)) {
        setTheme('dark');
    } else {
        setTheme('light');
    }
}

// Attach event listener to the toggle button
document.addEventListener('DOMContentLoaded', () => {
    initTheme(); // Set the initial theme

    const themeToggle = document.getElementById('theme-toggle');
    themeToggle.addEventListener('click', () => {
        // Simple toggle based on the current class
        if (document.body.classList.contains('dark-mode')) {
            setTheme('light');
        } else {
            setTheme('dark');
        }
    });
});
