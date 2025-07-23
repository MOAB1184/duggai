/**
 * app.js for DuggAI Landing Page
 *
 * This script handles:
 * 1. Initializing Typed.js for the hero section's dynamic text.
 * 2. Implementing scroll-triggered animations for sections using Intersection Observer.
 * 3. Smooth scrolling for navigation links.
 */

document.addEventListener('DOMContentLoaded', () => {

    // 1. Typed.js Initialization
    // Animates the headline in the hero section.
    if (document.getElementById('typed-text')) {
        new Typed('#typed-text', {
            strings: ['Instantly.', 'Without Limits.', 'From a single prompt.', 'With DuggAI.'],
            typeSpeed: 50,
            backSpeed: 30,
            backDelay: 2000,
            loop: true,
            smartBackspace: true,
        });
    }

    // 2. Scroll-triggered Animations
    // Uses Intersection Observer to add 'is-visible' class to elements when they enter the viewport.
    const scrollElements = document.querySelectorAll('.animate-on-scroll');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                // Optional: stop observing once the element is visible
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1 // Trigger when 10% of the element is visible
    });

    scrollElements.forEach(element => {
        observer.observe(element);
    });

    // 3. Smooth Scrolling for Navigation Links
    // Prevents the default jump and smoothly scrolls to the section.
    const navLinks = document.querySelectorAll('.main-nav a[href^="#"]');

    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            // Check if the link has a hash and it's not the CTA button
            if (this.hash !== "" && this.hash !== "#") {
                e.preventDefault();

                const targetId = this.hash;
                const targetElement = document.querySelector(targetId);

                if (targetElement) {
                    targetElement.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            }
        });
    });

    // 4. Waitlist Modal Logic
    const getStartedBtn = document.querySelector('.nav-cta');
    const waitlistModal = document.getElementById('waitlist-modal');
    const waitlistClose = document.getElementById('waitlist-close');
    const waitlistForm = document.getElementById('waitlist-form');
    const waitlistSuccess = document.getElementById('waitlist-success');
    const waitlistEmail = document.getElementById('waitlist-email');

    if (getStartedBtn && waitlistModal) {
        getStartedBtn.addEventListener('click', function(e) {
            e.preventDefault();
            waitlistModal.style.display = 'flex';
            waitlistEmail.focus();
        });
    }
    if (waitlistClose) {
        waitlistClose.addEventListener('click', function() {
            waitlistModal.style.display = 'none';
            waitlistForm.reset();
            waitlistSuccess.style.display = 'none';
        });
    }
    // Close modal when clicking outside content
    if (waitlistModal) {
        waitlistModal.addEventListener('click', function(e) {
            if (e.target === waitlistModal) {
                waitlistModal.style.display = 'none';
                waitlistForm.reset();
                waitlistSuccess.style.display = 'none';
            }
        });
    }
    // Handle form submission
    if (waitlistForm) {
        waitlistForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            waitlistSuccess.style.display = 'none';
            const email = waitlistEmail.value.trim();
            if (!email) return;
            try {
                const res = await fetch('/api/waitlist', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });
                const data = await res.json();
                if (data.success) {
                    waitlistSuccess.textContent = "Thank you! You're on the waitlist.";
                    waitlistSuccess.style.color = 'var(--success-color)';
                    waitlistSuccess.style.display = 'block';
                    waitlistForm.reset();
                } else {
                    waitlistSuccess.textContent = data.error || 'Something went wrong.';
                    waitlistSuccess.style.color = 'var(--fail-color)';
                    waitlistSuccess.style.display = 'block';
                }
            } catch (err) {
                waitlistSuccess.textContent = 'Network error. Please try again.';
                waitlistSuccess.style.color = 'var(--fail-color)';
                waitlistSuccess.style.display = 'block';
            }
        });
    }
});