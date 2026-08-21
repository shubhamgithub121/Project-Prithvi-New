import React, { useState, useEffect } from 'react'
import { carouselSlides, features, blogPosts } from '../data/content'
import './Home.css'
import { supabase } from '../lib/supabaseClient'

const Home = () => {
  const [currentSlide, setCurrentSlide] = useState(0)
  const [blogs, setBlogs] = useState(blogPosts)

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % carouselSlides.length)
    }, 5000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let channel;
    async function syncBlogs() {
      let richBlogs = [];
      try {
        const res = await fetch('https://dev.to/api/articles?tag=environment&per_page=6')
        if (res.ok) {
          const data = await res.json()
          
          richBlogs = data.map(b => ({
            id: b.id,
            title: b.title,
            url: b.url,
            image: b.cover_image || b.social_image || 'https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?auto=format&fit=crop&q=80',
            excerpt: b.description || 'Learn more about environmental impact, sustainability, and plastic recycling.',
            created_at: b.published_at || b.created_at,
            date: new Date(b.published_at || b.created_at).toLocaleDateString()
          }))
          setBlogs(richBlogs)

          // Upsert to Supabase matching expected schema
          const formatted = data.map(b => ({
            id: b.id,
            title: b.title,
            url: b.url,
            created_at: b.published_at || b.created_at
          }))
          await supabase.from('blogs').upsert(formatted)
        }
      } catch (e) {
        console.error('Failed to fetch and upsert blogs:', e)
      }

      // If API failed, fallback to Supabase DB
      if (richBlogs.length === 0) {
        const { data: dbBlogs } = await supabase.from('blogs').select('*').order('created_at', { ascending: false }).limit(6)
        if (dbBlogs && dbBlogs.length > 0) {
          setBlogs(dbBlogs)
        }
      }

      channel = supabase.channel('schema-db-changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'blogs' },
          (payload) => {
            setBlogs((prev) => {
              if (payload.eventType === 'INSERT') {
                return [payload.new, ...prev].slice(0, 6)
              } else if (payload.eventType === 'UPDATE') {
                return prev.map(b => b.id === payload.new.id ? payload.new : b)
              }
              return prev
            })
          }
        )
        .subscribe()
    }
    syncBlogs()
    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [])

  const nextSlide = () => {
    setCurrentSlide((prev) => (prev + 1) % carouselSlides.length)
  }

  const prevSlide = () => {
    setCurrentSlide((prev) => (prev - 1 + carouselSlides.length) % carouselSlides.length)
  }

  return (
    <div className="home-page">

      {/* ================= HERO / CAROUSEL ================= */}
      <section className="hero-section">
        <div className="carousel">
          {carouselSlides.map((slide, index) => (
            <div
              key={slide.id}
              className={`carousel-slide ${index === currentSlide ? 'active' : ''}`}
            >
              {/* Background Image */}
              <img
                src={slide.image}
                alt={slide.title}
                className="carousel-bg"
              />

              {/* Dark Overlay */}
              <div className="carousel-overlay"></div>

              {/* Text on Image */}
              <div className="slide-content">
                
                <h1 className="slide-title">{slide.title}</h1>
                <p className="slide-subtitle">{slide.subtitle}</p>
                <p className="slide-description">{slide.description}</p>
              </div>
            </div>
          ))}

          <button className="carousel-btn prev" onClick={prevSlide}>‹</button>
          <button className="carousel-btn next" onClick={nextSlide}>›</button>

          <div className="carousel-indicators">
            {carouselSlides.map((_, index) => (
              <button
                key={index}
                className={`indicator ${index === currentSlide ? 'active' : ''}`}
                onClick={() => setCurrentSlide(index)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ================= FEATURES ================= */}
      <section className="section features-section">
        <div className="container">
          <h2 className="section-title">Our Services</h2>
          <p className="section-subtitle">
            Making plastic recycling simple, rewarding, and impactful
          </p>

          <div className="features-grid">
            {features.map((feature) => (
              <div key={feature.id} className="feature-card card">
                <div className="feature-icon">{feature.icon}</div>
                <h3 className="feature-title">{feature.title}</h3>
                <p className="feature-description">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= AWARENESS / BLOG ================= */}
      <section className="section awareness-section">
        <div className="container">
          <h2 className="section-title">Awareness & Impact</h2>
          <p className="section-subtitle">
            Learn about plastic pollution and how you can make a difference
          </p>

          <div className="blog-grid">
            {blogs.map((post) => (
              <a 
                key={post.id} 
                href={post.url || '#'} 
                target="_blank" 
                rel="noopener noreferrer" 
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                <article className="blog-card card" style={{ height: '100%' }}>
                  <div className="blog-image">
                    <img 
                      src={post.image || post.cover_image || 'https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?auto=format&fit=crop&q=80'} 
                      alt={post.title} 
                      className="blog-img"
                    />
                  </div>
                  <div className="blog-content">
                    <h3 className="blog-title">{post.title}</h3>
                    <p className="blog-excerpt">{post.excerpt || post.description || 'Learn more about environmental impact, sustainability, and plastic recycling.'}</p>
                    <span className="blog-date">{post.date || new Date(post.created_at).toLocaleDateString()}</span>
                  </div>
                </article>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ================= CTA ================= */}
      <section className="cta-section">
        <div className="container">
          <div className="cta-content">
            <h2 className="cta-title">Ready to Make a Difference?</h2>
            <p className="cta-text">
              Join thousands of Indians who are recycling plastic and earning rewards
            </p>
            <a href="/schedule-pickup" className="btn btn-primary">
              Schedule Your First Pickup
            </a>
          </div>
        </div>
      </section>

    </div>
  )
}

export default Home
