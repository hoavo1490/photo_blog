task :default => :serve

desc 'Start dev server'
task :serve do
  sh 'bundle exec jekyll serve --watch'
end

desc 'Build site'
task :build do
  sh 'bundle exec jekyll build'
end

desc 'Deploy with rake "deploy[comment]"'
task :deploy, [:comment] => :build do |t, args|
  msg = args.comment || 'new deployment'
  sh "git commit . -m '#{msg}' && git push"
end

desc 'Create new post: rake "post[post-name]"'
task :post, [:title] do |t, args|
  abort 'rake "post[post-name]"' unless args.title
  time = Time.now
  filename = "_posts/#{time.strftime('%Y-%m-%d-')}#{args.title}.markdown"
  abort "Post already exists: #{filename}" if File.exist?(filename)
  uuid = `uuidgen`.strip.downcase
  File.write(filename, <<~POST)
    ---
    title: #{args.title}
    layout: post
    guid: urn:uuid:#{uuid}
    tags:
      -
    ---


  POST
  `echo "#{filename}" | pbcopy`
  `git add #{filename}`
  puts "created #{filename}"
end
